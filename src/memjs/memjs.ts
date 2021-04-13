// MemTS Memcache Client

import {
  OnErrorCallback,
  OnResponseCallback,
  Server,
  ServerOptions,
} from "./server";
import { noopSerializer, Serializer } from "./noop-serializer";
import {
  makeRequestBuffer,
  copyIntoRequestBuffer,
  merge,
  makeExpiration,
  makeAmountInitialAndExpiration,
  hashCode,
  MaybeBuffer,
  Message,
} from "./utils";
import * as constants from "./constants";
import { ResponseStatus } from "./constants";
import * as Utils from "./utils";
import * as Header from "./header";

function defaultKeyToServerHashFunction(
  servers: string[],
  key: string
): string {
  const total = servers.length;
  const index = total > 1 ? hashCode(key) % total : 0;
  return servers[index];
}

// converts a call into a promise-returning one
function promisify<Result>(
  command: (callback: (error: Error | null, result: Result) => void) => void
): Promise<Result> {
  return new Promise(function (resolve, reject) {
    command(function (err, result) {
      err ? reject(err) : resolve(result);
    });
  });
}

type ResponseOrErrorCallback = (
  error: Error | null,
  response: Message | null
) => void;

interface BaseClientOptions {
  retries: number;
  retry_delay: number;
  expires: number;
  logger: { log: typeof console.log };
  keyToServerHashFunction: typeof defaultKeyToServerHashFunction;
}

interface SerializerProp<Value, Extras> {
  serializer: Serializer<Value, Extras>;
}

/**
 * The client has partial support for serializing and deserializing values from the
 * Buffer byte strings we recieve from the wire. The default serializer is for MaybeBuffer.
 *
 * If Value and Extras are of type Buffer, then return type WhenBuffer. Otherwise,
 * return type NotBuffer.
 */
type IfBuffer<
  Value,
  Extras,
  WhenValueAndExtrasAreBuffers,
  NotBuffer
> = Value extends Buffer
  ? Extras extends Buffer
    ? WhenValueAndExtrasAreBuffers
    : NotBuffer
  : NotBuffer;

export type GivenClientOptions<Value, Extras> = Partial<BaseClientOptions> &
  IfBuffer<
    Value,
    Extras,
    Partial<SerializerProp<Value, Extras>>,
    SerializerProp<Value, Extras>
  >;

export type CASToken = Buffer;

export interface GetResult<Value = MaybeBuffer, Extras = MaybeBuffer> {
  value: Value;
  extras: Extras;
  cas: CASToken | undefined;
}

export type GetMultiResult<
  Keys extends string = string,
  Value = MaybeBuffer,
  Extras = MaybeBuffer
> = {
  [K in Keys]?: GetResult<Value, Extras>;
};

class Client<Value = MaybeBuffer, Extras = MaybeBuffer> {
  servers: Server[];
  seq: number;
  options: BaseClientOptions & Partial<SerializerProp<Value, Extras>>;
  serializer: Serializer<Value, Extras>;
  serverMap: { [hostport: string]: Server };
  serverKeys: string[];

  // Client initializer takes a list of `Server`s and an `options` dictionary.
  // See `Client.create` for details.
  constructor(servers: Server[], options: GivenClientOptions<Value, Extras>) {
    this.servers = servers;
    this.seq = 0;
    this.options = merge(options || {}, {
      retries: 2,
      retry_delay: 0.2,
      expires: 0,
      logger: console,
      keyToServerHashFunction: defaultKeyToServerHashFunction,
    });

    this.serializer = this.options.serializer || (noopSerializer as any);

    // Store a mapping from hostport -> server so we can quickly get a server object from the serverKey returned by the hashing function
    const serverMap: { [hostport: string]: Server } = {};
    this.servers.forEach(function (server) {
      serverMap[server.hostportString()] = server;
    });
    this.serverMap = serverMap;

    // store a list of all our serverKeys so we don't need to constantly reallocate this array
    this.serverKeys = Object.keys(this.serverMap);
  }

  /**
   * Creates a new client given an optional config string and optional hash of
   * options. The config string should be of the form:
   *
   *     "[user:pass@]server1[:11211],[user:pass@]server2[:11211],..."
   *
   * If the argument is not given, fallback on the `MEMCACHIER_SERVERS` environment
   * variable, `MEMCACHE_SERVERS` environment variable or `"localhost:11211"`.
   *
   * The options hash may contain the options:
   *
   * * `retries` - the number of times to retry an operation in lieu of failures
   * (default 2)
   * * `expires` - the default expiration in seconds to use (default 0 - never
   * expire). If `expires` is greater than 30 days (60 x 60 x 24 x 30), it is
   * treated as a UNIX time (number of seconds since January 1, 1970).
   * * `logger` - a logger object that responds to `log(string)` method calls.
   *
   *   ~~~~
   *     log(msg1[, msg2[, msg3[...]]])
   *   ~~~~
   *
   *   Defaults to `console`.
   * * `serializer` - the object which will (de)serialize the data. It needs
   *   two public methods: serialize and deserialize. It defaults to the
   *   noopSerializer:
   *
   *   ~~~~
   *   const noopSerializer = {
   *     serialize: function (opcode, value, extras) {
   *       return { value: value, extras: extras };
   *     },
   *     deserialize: function (opcode, value, extras) {
   *       return { value: value, extras: extras };
   *     }
   *   };
   *   ~~~~
   *
   * Or options for the servers including:
   * * `username` and `password` for fallback SASL authentication credentials.
   * * `timeout` in seconds to determine failure for operations. Default is 0.5
   *             seconds.
   * * 'conntimeout' in seconds to connection failure. Default is twice the value
   *                 of `timeout`.
   * * `keepAlive` whether to enable keep-alive functionality. Defaults to false.
   * * `keepAliveDelay` in seconds to the initial delay before the first keepalive
   *                    probe is sent on an idle socket. Defaults is 30 seconds.
   * * `keyToServerHashFunction` a function to map keys to servers, with the signature
   *                            (serverKeys: string[], key: string): string
   *                            NOTE: if you need to do some expensive initialization, *please* do it lazily the first time you this function is called with an array of serverKeys, not on every call
   */
  static create<Value, Extras>(
    serversStr: string | undefined,
    options: IfBuffer<
      Value,
      Extras,
      undefined | (Partial<ServerOptions> & GivenClientOptions<Value, Extras>),
      Partial<ServerOptions> & GivenClientOptions<Value, Extras>
    >
  ): Client<Value, Extras> {
    serversStr =
      serversStr ||
      process.env.MEMCACHIER_SERVERS ||
      process.env.MEMCACHE_SERVERS ||
      "localhost:11211";
    const serverUris = serversStr.split(",");
    const servers = serverUris.map(function (uri) {
      const uriParts = uri.split("@");
      const hostPort = uriParts[uriParts.length - 1].split(":");
      const userPass = (uriParts[uriParts.length - 2] || "").split(":");
      return new Server(
        hostPort[0],
        parseInt(hostPort[1] || "11211", 10),
        userPass[0],
        userPass[1],
        options
      );
    });
    return new Client(servers, options as any);
  }

  /**
   * Given a serverKey fromlookupKeyToServerKey, return the corresponding Server instance
   *
   * @param  {string} serverKey
   * @returns {Server}
   */
  serverKeyToServer(serverKey: string): Server {
    return this.serverMap[serverKey];
  }

  /**
   * Given a key to look up in memcache, return a serverKey (based on some
   * hashing function) which can be used to index this.serverMap
   */
  lookupKeyToServerKey(key: string): string {
    return this.options.keyToServerHashFunction(this.serverKeys, key);
  }

  /**
   * Retrieves the value at the given key in memcache.
   */
  async get(key: string): Promise<GetResult<Value, Extras> | null> {
    this.incrSeq();
    const request = makeRequestBuffer(constants.OP_GET, key, "", "", this.seq);
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        const deserialized = this.serializer.deserialize(
          response.header.opcode,
          response.val,
          response.extras
        );
        return { ...deserialized, cas: response.header.cas };
      case ResponseStatus.KEY_NOT_FOUND:
        return null;
      default:
        throw this.createAndLogError("GET", response.header.status);
    }
  }

  /** Build a pipelined get multi request by sending one GETKQ for each key (quiet, meaning it won't respond if the value is missing) followed by a no-op to force a response (and to give us a sentinel response that the pipeline is done)
   *
   * cf https://github.com/couchbase/memcached/blob/master/docs/BinaryProtocol.md#0x0d-getkq-get-with-key-quietly
   */
  _buildGetMultiRequest(keys: string[]): Buffer {
    // start at 24 for the no-op command at the end
    let requestSize = 24;
    for (const keyIdx in keys) {
      requestSize += Buffer.byteLength(keys[keyIdx], "utf8") + 24;
    }

    const request = Buffer.alloc(requestSize);

    let bytesWritten = 0;
    for (const keyIdx in keys) {
      const key = keys[keyIdx];
      bytesWritten += copyIntoRequestBuffer(
        constants.OP_GETKQ,
        key,
        "",
        "",
        this.seq,
        request,
        bytesWritten
      );
    }

    bytesWritten += copyIntoRequestBuffer(
      constants.OP_NO_OP,
      "",
      "",
      "",
      this.seq,
      request,
      bytesWritten
    );

    return request;
  }

  /** Executing a pipelined (multi) get against a single server. This is a private implementation detail of getMulti. */
  async _getMultiToServer<Keys extends string>(
    serv: Server,
    keys: Keys[]
  ): Promise<GetMultiResult<Keys, Value, Extras>> {
    return new Promise((resolve, reject) => {
      const responseMap: GetMultiResult<string, Value, Extras> = {};

      const handle: OnResponseCallback = (response) => {
        switch (response.header.status) {
          case ResponseStatus.SUCCESS:
            // When we get the no-op response, we are done with this one getMulti in the per-backend fan-out
            if (response.header.opcode === constants.OP_NO_OP) {
              // This ensures the handler will be deleted from the responseCallbacks map in server.js
              // This isn't technically needed here because the logic in server.js also checks if totalBodyLength === 0, but our unittests aren't great about setting that field, and also this makes it more explicit
              handle.quiet = false;
              resolve(responseMap);
            } else {
              const deserialized = this.serializer.deserialize(
                response.header.opcode,
                response.val,
                response.extras
              );
              const key = response.key.toString();
              responseMap[key] = { ...deserialized, cas: response.header.cas };
            }
            break;
          default:
            return reject(
              this.createAndLogError("GET", response.header.status)
            );
        }
      };
      // This prevents the handler from being deleted
      // after the first response. Logic in server.js.
      handle.quiet = true;

      const request = this._buildGetMultiRequest(keys);
      serv.onResponse(this.seq, handle);
      serv.onError(this.seq, reject);
      this.incrSeq();
      serv.write(request);
    });
  }

  /**
   * Retrievs the value at the given keys in memcached. Returns a map from the
   * requested keys to results, or null if the key was not found.
   */
  async getMulti<Keys extends string>(
    keys: Keys[]
  ): Promise<GetMultiResult<Keys, Value, Extras>> {
    const serverKeytoLookupKeys: {
      [serverKey: string]: string[];
    } = {};
    keys.forEach((lookupKey) => {
      const serverKey = this.lookupKeyToServerKey(lookupKey);
      if (!serverKeytoLookupKeys[serverKey]) {
        serverKeytoLookupKeys[serverKey] = [];
      }
      serverKeytoLookupKeys[serverKey].push(lookupKey);
    });

    const usedServerKeys = Object.keys(serverKeytoLookupKeys);
    const results = await Promise.all(
      usedServerKeys.map((serverKey) => {
        const server = this.serverKeyToServer(serverKey);
        return this._getMultiToServer(server, serverKeytoLookupKeys[serverKey]);
      })
    );

    return Object.assign({}, ...results);
  }

  /**
   * Sets `key` to `value`.
   */
  async set(
    key: string,
    value: Value,
    options?: { expires?: number; cas?: CASToken }
  ): Promise<boolean | null> {
    const expires = options?.expires;
    const cas = options?.cas;

    // TODO: support flags
    this.incrSeq();
    const expiration = makeExpiration(expires || this.options.expires);
    const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);
    const serialized = this.serializer.serialize(
      constants.OP_SET,
      value,
      extras
    );
    const request = Utils.encodeRequest({
      header: {
        opcode: constants.OP_SET,
        opaque: this.seq,
        cas,
      },
      key,
      value: serialized.value,
      extras: serialized.extras,
    });
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_EXISTS:
        if (cas) {
          return false;
        } else {
          throw this.createAndLogError("SET", response.header.status);
        }
      default:
        throw this.createAndLogError("SET", response.header.status);
    }
  }

  /**
   * ADD
   *
   * Adds the given _key_ and _value_ to memcache. The operation only succeeds
   * if the key is not already set.
   *
   * The options dictionary takes:
   * * _expires_: overrides the default expiration (see `Client.create`) for this
   *              particular key-value pair.
   */
  async add(
    key: string,
    value: Value,
    options?: { expires?: number }
  ): Promise<boolean | null> {
    // TODO: support flags, support version (CAS)
    this.incrSeq();
    const expiration = makeExpiration(options?.expires || this.options.expires);
    const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);

    const opcode = constants.OP_ADD;
    const serialized = this.serializer.serialize(opcode, value, extras);
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_EXISTS:
        return false;
        break;
      default:
        throw this.createAndLogError("ADD", response.header.status);
    }
  }

  /**
   * Replaces the given _key_ and _value_ to memcache. The operation only succeeds
   * if the key is already present.
   */
  async replace(
    key: string,
    value: Value,
    options?: { expires?: number }
  ): Promise<boolean | null> {
    // TODO: support flags, support version (CAS)
    this.incrSeq();
    const expiration = makeExpiration(options?.expires || this.options.expires);
    const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);

    const opcode: constants.OP = constants.OP_REPLACE;
    const serialized = this.serializer.serialize(opcode, value, extras);
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_NOT_FOUND:
        return false;
      default:
        throw this.createAndLogError("REPLACE", response.header.status);
    }
  }

  /**
   * Deletes the given _key_ from memcache. The operation only succeeds
   * if the key is already present.
   */
  async delete(key: string): Promise<boolean> {
    // TODO: Support version (CAS)
    this.incrSeq();
    const request = makeRequestBuffer(4, key, "", "", this.seq);
    const response = await this.perform(key, request, this.seq);

    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_NOT_FOUND:
        return false;
      default:
        throw this.createAndLogError("DELETE", response?.header.status);
    }
  }

  /**
   * Increments the given _key_ in memcache.
   */
  async increment(
    key: string,
    amount: number,
    options?: { initial?: number; expires?: number }
  ): Promise<{ value: number | null; success: boolean | null }> {
    // TODO: support version (CAS)
    this.incrSeq();
    const initial = options?.initial || 0;
    const expires = options?.expires || this.options.expires;
    const extras = makeAmountInitialAndExpiration(amount, initial, expires);
    const request = makeRequestBuffer(
      constants.OP_INCREMENT,
      key,
      extras,
      "",
      this.seq
    );
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        const bufInt =
          (response.val.readUInt32BE(0) << 8) + response.val.readUInt32BE(4);
        return { value: bufInt, success: true };
      default:
        throw this.createAndLogError("INCREMENT", response.header.status);
    }
  }

  /**
   * Decrements the given `key` in memcache.
   */
  async decrement(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number }
  ): Promise<{ value: number | null; success: boolean | null }> {
    // TODO: support version (CAS)
    this.incrSeq();
    const initial = options.initial || 0;
    const expires = options.expires || this.options.expires;
    const extras = makeAmountInitialAndExpiration(amount, initial, expires);
    const request = makeRequestBuffer(
      constants.OP_DECREMENT,
      key,
      extras,
      "",
      this.seq
    );
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        const bufInt =
          (response.val.readUInt32BE(0) << 8) + response.val.readUInt32BE(4);
        return { value: bufInt, success: true };
      default:
        throw this.createAndLogError("DECREMENT", response.header.status);
    }
  }

  /**
   * Append the given _value_ to the value associated with the given _key_ in
   * memcache. The operation only succeeds if the key is already present.
   */
  async append(key: string, value: Value): Promise<boolean> {
    // TODO: support version (CAS)
    this.incrSeq();
    const opcode: constants.OP = constants.OP_APPEND;
    const serialized = this.serializer.serialize(opcode, value, "");
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_NOT_FOUND:
        return false;
      default:
        throw this.createAndLogError("APPEND", response.header.status);
    }
  }

  /**
   * Prepend the given _value_ to the value associated with the given _key_ in
   * memcache. The operation only succeeds if the key is already present.
   */
  async prepend(key: string, value: Value): Promise<boolean> {
    // TODO: support version (CAS)
    this.incrSeq();
    const opcode: constants.OP = constants.OP_PREPEND;
    const serialized = this.serializer.serialize(opcode, value, "");
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_NOT_FOUND:
        return false;
      default:
        throw this.createAndLogError("PREPEND", response.header.status);
    }
  }

  /**
   * Touch sets an expiration value, given by _expires_, on the given _key_ in
   * memcache. The operation only succeeds if the key is already present.
   */
  async touch(key: string, expires: number): Promise<boolean> {
    // TODO: support version (CAS)
    this.incrSeq();
    const extras = makeExpiration(expires || this.options.expires);
    const request = makeRequestBuffer(0x1c, key, extras, "", this.seq);
    const response = await this.perform(key, request, this.seq);
    switch (response.header.status) {
      case ResponseStatus.SUCCESS:
        return true;
      case ResponseStatus.KEY_NOT_FOUND:
        return false;
      default:
        throw this.createAndLogError("TOUCH", response.header.status);
    }
  }

  /**
   * FLUSH
   *
   * Flushes the cache on each connected server. The callback signature is:
   *
   *     callback(lastErr, results)
   *
   * where _lastErr_ is the last error encountered (or null, in the common case
   * of no errors). _results_ is a dictionary mapping `"hostname:port"` to either
   * `true` (if the operation was successful), or an error.
   * @param callback
   */
  flush(): Promise<Record<string, boolean | Error>>;
  flush(
    callback: (
      err: Error | null,
      results: Record<string, boolean | Error>
    ) => void
  ): void;
  flush(
    callback?: (
      err: Error | null,
      results: Record<string, boolean | Error>
    ) => void
  ) {
    if (callback === undefined) {
      return promisify((callback) => {
        this.flush(function (err, results) {
          callback(err, results);
        });
      });
    }
    // TODO: support expiration
    this.incrSeq();
    const request = makeRequestBuffer(0x08, "", "", "", this.seq);
    let count = this.servers.length;
    const result: Record<string, boolean | Error> = {};
    let lastErr: Error | null = null;

    const handleFlush = function (seq: number, serv: Server) {
      serv.onResponse(seq, function (/* response */) {
        count -= 1;
        result[serv.hostportString()] = true;
        if (callback && count === 0) {
          callback(lastErr, result);
        }
      });
      serv.onError(seq, function (err) {
        count -= 1;
        lastErr = err;
        result[serv.hostportString()] = err;
        if (callback && count === 0) {
          callback(lastErr, result);
        }
      });
      serv.write(request);
    };

    for (let i = 0; i < this.servers.length; i++) {
      handleFlush(this.seq, this.servers[i]);
    }
  }

  /**
   * STATS_WITH_KEY
   *
   * Sends a memcache stats command with a key to each connected server. The
   * callback is invoked **ONCE PER SERVER** and has the signature:
   *
   *     callback(err, server, stats)
   *
   * _server_ is the `"hostname:port"` of the server, and _stats_ is a dictionary
   * mapping the stat name to the value of the statistic as a string.
   * @param key
   * @param callback
   */
  statsWithKey(
    key: string,
    callback?: (
      err: Error | null,
      server: string,
      stats: Record<string, string> | null
    ) => void
  ): void {
    this.incrSeq();
    const request = makeRequestBuffer(0x10, key, "", "", this.seq);

    const handleStats = (seq: number, serv: Server) => {
      const result: Record<string, string> = {};
      const handle: OnResponseCallback = (response) => {
        // end of stat responses
        if (response.header.totalBodyLength === 0) {
          if (callback) {
            callback(null, serv.hostportString(), result);
          }
          return;
        }
        // process single stat line response
        switch (response.header.status) {
          case ResponseStatus.SUCCESS:
            result[response.key.toString()] = response.val.toString();
            break;
          default:
            const error = this.handleResponseError(
              `STATS (${key})`,
              response.header.status,
              undefined
            );
            if (callback) {
              callback(error, serv.hostportString(), null);
            }
        }
      };
      handle.quiet = true;

      serv.onResponse(seq, handle);
      serv.onError(seq, function (err) {
        if (callback) {
          callback(err, serv.hostportString(), null);
        }
      });
      serv.write(request);
    };

    for (let i = 0; i < this.servers.length; i++) {
      handleStats(this.seq, this.servers[i]);
    }
  }

  /**
   * STATS
   *
   * Fetches memcache stats from each connected server. The callback is invoked
   * **ONCE PER SERVER** and has the signature:
   *
   *     callback(err, server, stats)
   *
   * _server_ is the `"hostname:port"` of the server, and _stats_ is a
   * dictionary mapping the stat name to the value of the statistic as a string.
   * @param callback
   */
  stats(
    callback?: (
      err: Error | null,
      server: string,
      stats: Record<string, string> | null
    ) => void
  ): void {
    this.statsWithKey("", callback);
  }

  /**
   * RESET_STATS
   *
   * Reset the statistics each server is keeping back to zero. This doesn't clear
   * stats such as item count, but temporary stats such as total number of
   * connections over time.
   *
   * The callback is invoked **ONCE PER SERVER** and has the signature:
   *
   *     callback(err, server)
   *
   * _server_ is the `"hostname:port"` of the server.
   * @param callback
   */
  resetStats(
    callback?: (
      err: Error | null,
      server: string,
      stats: Record<string, string> | null
    ) => void
  ): void {
    this.statsWithKey("reset", callback);
  }

  /**
   * QUIT
   *
   * Closes the connection to each server, notifying them of this intention. Note
   * that quit can race against already outstanding requests when those requests
   * fail and are retried, leading to the quit command winning and closing the
   * connection before the retries complete.
   */
  quit() {
    this.incrSeq();
    // TODO: Nicer perhaps to do QUITQ (0x17) but need a new callback for when
    // write is done.
    const request = makeRequestBuffer(0x07, "", "", "", this.seq); // QUIT
    let serv;

    const handleQuit = function (seq: number, serv: Server) {
      serv.onResponse(seq, function (/* response */) {
        serv.close();
      });
      serv.onError(seq, function (/* err */) {
        serv.close();
      });
      serv.write(request);
    };

    for (let i = 0; i < this.servers.length; i++) {
      serv = this.servers[i];
      handleQuit(this.seq, serv);
    }
  }

  _version(server: Server): Promise<{ value: Value | null }> {
    return new Promise((resolve, reject) => {
      this.incrSeq();
      const request = makeRequestBuffer(
        constants.OP_VERSION,
        "",
        "",
        "",
        this.seq
      );
      this.performOnServer(server, request, this.seq, (err, response) => {
        if (err) {
          return reject(err);
        }

        switch (response!.header.status) {
          case ResponseStatus.SUCCESS:
            /* TODO: this is bugged, we should't use the deserializer here, since version always returns a version string.
             The deserializer should only be used on user key data. */
            const deserialized = this.serializer.deserialize(
              response!.header.opcode,
              response!.val,
              response!.extras
            );
            return resolve({ value: deserialized.value });
          default:
            return reject(
              this.createAndLogError("VERSION", response!.header.status)
            );
        }
      });
    });
  }

  /**
   * Request the server version from the "first" server in the backend pool.
   * The server responds with a packet containing the version string in the body with the following format: "x.y.z"
   */
  version(): Promise<{ value: Value | null }> {
    const server = this.serverKeyToServer(this.serverKeys[0]);
    return this._version(server);
  }

  /**
   * Retrieves the server version from all the servers
   * in the backend pool, errors if any one of them has an
   * error
   */
  async versionAll(): Promise<{
    values: Record<string, Value | null>;
  }> {
    const versionObjects = await Promise.all(
      this.serverKeys.map((serverKey) => {
        const server = this.serverKeyToServer(serverKey);

        return this._version(server).then((response) => {
          return { serverKey: serverKey, value: response.value };
        });
      })
    );
    const values = versionObjects.reduce((accumulator, versionObject) => {
      accumulator[versionObject.serverKey] = versionObject.value;
      return accumulator;
    }, {} as Record<string, Value | null>);
    return { values: values };
  }

  /**
   * Closes (abruptly) connections to all the servers.
   * @see this.quit
   */
  close() {
    for (let i = 0; i < this.servers.length; i++) {
      this.servers[i].close();
    }
  }

  /**
   * Perform a generic single response operation (get, set etc) on one server
   *
   * @param {string} key the key to hash to get a server from the pool
   * @param {buffer} request a buffer containing the request
   * @param {number} seq the sequence number of the operation. It is used to pin the callbacks
                         to a specific operation and should never change during a `perform`.
   * @param {number?} retries number of times to retry request on failure
   */
  perform(
    key: string,
    request: Buffer,
    seq: number,
    retries?: number
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const serverKey = this.lookupKeyToServerKey(key);
      const server = this.serverKeyToServer(serverKey);

      if (!server) {
        return reject(new Error("No servers available"));
      }

      this.performOnServer(
        server,
        request,
        seq,
        (error, response) => {
          if (error) {
            return reject(error);
          }
          resolve(response!);
        },
        retries
      );
    });
  }

  performOnServer(
    server: Server,
    request: Buffer,
    seq: number,
    callback: ResponseOrErrorCallback,
    retries: number = 0
  ) {
    const _this = this;

    retries = retries || this.options.retries;
    const origRetries = this.options.retries;
    const logger = this.options.logger;
    const retry_delay = this.options.retry_delay;

    const responseHandler: OnResponseCallback = function (response) {
      if (callback) {
        callback(null, response);
      }
    };

    const errorHandler: OnErrorCallback = function (error) {
      if (--retries > 0) {
        // Wait for retry_delay
        setTimeout(function () {
          _this.performOnServer(server, request, seq, callback, retries);
        }, 1000 * retry_delay);
      } else {
        logger.log(
          "MemJS: Server <" +
            server.hostportString() +
            "> failed after (" +
            origRetries +
            ") retries with error - " +
            error.message
        );
        if (callback) {
          callback(error, null);
        }
      }
    };

    server.onResponse(seq, responseHandler);
    server.onError(seq, errorHandler);
    server.write(request);
  }

  // Increment the seq value
  incrSeq() {
    this.seq++;

    // Wrap `this.seq` to 32-bits since the field we fit it into is only 32-bits.
    this.seq &= 0xffffffff;
  }

  private createAndLogError(
    commandName: string,
    responseStatus: ResponseStatus | undefined
  ): Error {
    const errorMessage = `MemJS ${commandName}: ${constants.responseStatusToString(
      responseStatus
    )}`;
    this.options.logger.log(errorMessage);
    return new Error(errorMessage);
  }

  /**
   * Log an error to the logger, then return the error.
   * If a callback is given, call it with callback(error, null).
   */
  private handleResponseError(
    commandName: string,
    responseStatus: ResponseStatus | undefined,
    callback: undefined | ((error: Error | null, other: null) => void)
  ): Error {
    const error = this.createAndLogError(commandName, responseStatus);
    if (callback) {
      callback(error, null);
    }
    return error;
  }
}

export { Client, Server, Utils, Header };
