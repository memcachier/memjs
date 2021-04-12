// MemTS Memcache Client

import { errors, UNKNOWN_ERROR } from "./protocol";
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

  // ## Memcache Commands
  //
  // All commands return their results through a callback passed as the last
  // required argument (some commands, like `Client#set`, take optional arguments
  // after the callback).
  //
  // The callback signature always follows:
  //
  //     callback(err, [arg1[, arg2[, arg3[...]]]])
  //
  // In case of an error the _err_ argument will be non-null and contain the
  // `Error`. A notable exception includes a `Client#get` on a key that doesn't
  // exist. In this case, _err_ will be null, as will the _value and _extras_
  // arguments.

  /**
   * Retrieves the value at the given key in memcache.
   */
  get(key: string): Promise<GetResult<Value, Extras> | null>;
  get(
    key: string,
    callback: (
      error: Error | null,
      result: GetResult<Value, Extras> | null
    ) => void
  ): void;
  get(
    key: string,
    callback?: (
      error: Error | null,
      result: GetResult<Value, Extras> | null
    ) => void
  ): Promise<GetResult<Value, Extras> | null> | void {
    if (callback === undefined) {
      return promisify((callback) => {
        this.get(key, function (err, value) {
          callback(err, value);
        });
      });
    }
    const logger = this.options.logger;
    this.incrSeq();
    const request = makeRequestBuffer(constants.OP_GET, key, "", "", this.seq);
    this.perform(key, request, this.seq, (err, response) => {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            const deserialized = this.serializer.deserialize(
              response!.header.opcode,
              response!.val,
              response!.extras
            );
            callback(null, { ...deserialized, cas: response!.header.cas });
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            callback(null, null);
          }
          break;
        default:
          const errorMessage =
            "MemJS GET: " + errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
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
  _getMultiToServer<Keys extends string>(
    serv: Server,
    keys: Keys[],
    callback: (
      error: Error | null,
      values: GetMultiResult<Keys, Value, Extras> | null
    ) => void
  ) {
    const responseMap: GetMultiResult<string, Value, Extras> = {};

    const handle: OnResponseCallback = (response) => {
      switch (response.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            const deserialized = this.serializer.deserialize(
              response.header.opcode,
              response.val,
              response.extras
            );
            // When we get the no-op response, we are done with this one getMulti in the per-backend fan-out
            if (response.header.opcode === constants.OP_NO_OP) {
              // This ensures the handler will be deleted from the responseCallbacks map in server.js
              // This isn't technically needed here because the logic in server.js also checks if totalBodyLength === 0, but our unittests aren't great about setting that field, and also this makes it more explicit
              handle.quiet = false;
              callback(null, responseMap);
            } else {
              const key = response.key.toString();
              responseMap[key] = { ...deserialized, cas: response.header.cas };
            }
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            // @blackmad: IS THIS CORRECT???
            callback(null, null);
          }
          break;
        default:
          const errorMessage =
            "MemJS GET: " + errors[response.header.status || UNKNOWN_ERROR];
          this.options.logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    };
    // This prevents the handler from being deleted
    // after the first response. Logic in server.js.
    handle.quiet = true;

    const request = this._buildGetMultiRequest(keys);
    serv.onResponse(this.seq, handle);
    serv.onError(this.seq, function (err) {
      if (callback) {
        callback(err, null);
      }
    });
    this.incrSeq();
    serv.write(request);
  }

  /**
   * Retrievs the value at the given keys in memcached. Returns a map from the
   * requested keys to results, or null if the key was not found.
   */
  getMulti<Keys extends string>(
    keys: Keys[]
  ): Promise<GetMultiResult<Keys, Value, Extras> | null>;
  getMulti<Keys extends string>(
    keys: Keys[],
    callback: (
      error: Error | null,
      value: GetMultiResult<Keys, Value, Extras> | null
    ) => void
  ): void;
  getMulti<Keys extends string>(
    keys: Keys[],
    callback?: (
      error: Error | null,
      value: GetMultiResult<Keys, Value, Extras> | null
    ) => void
  ): Promise<GetMultiResult<Keys, Value, Extras> | null> | void {
    if (callback === undefined) {
      return promisify((callback) => {
        this.getMulti(keys, function (err, value) {
          callback(err, value);
        });
      });
    }

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
    let outstandingCalls = usedServerKeys.length;
    const recordMap: GetMultiResult<string, Value, Extras> = {};
    let hadError = false;
    function latchCallback(
      err: Error | null,
      values: GetMultiResult<string, Value, Extras> | null
    ) {
      if (hadError) {
        return;
      }

      if (err) {
        hadError = true;
        callback!(err, null);
        return;
      }

      merge(recordMap, values);
      outstandingCalls -= 1;
      if (outstandingCalls === 0) {
        callback!(null, recordMap);
      }
    }

    for (const serverKeyIndex in usedServerKeys) {
      const serverKey = usedServerKeys[serverKeyIndex];
      const server = this.serverKeyToServer(serverKey);
      this._getMultiToServer(
        server,
        serverKeytoLookupKeys[serverKey],
        latchCallback
      );
    }
  }

  /**
   * Sets the given _key_ to _value_.
   */
  set(
    key: string,
    value: Value,
    options?: { expires?: number; cas?: CASToken }
  ): Promise<boolean | null>;
  set(
    key: string,
    value: Value,
    options: { expires?: number; cas?: CASToken },
    callback: (error: Error | null, success: boolean | null) => void
  ): void;
  set(
    key: string,
    value: Value,
    options: { expires?: number; cas?: CASToken },
    callback?: (error: Error | null, success: boolean | null) => void
  ): Promise<boolean | null> | void {
    if (callback === undefined && typeof options !== "function") {
      if (!options) options = {};
      return promisify((callback) => {
        this.set(key, value, options, function (err, success) {
          callback(err, success);
        });
      });
    }

    const logger = this.options.logger;
    const expires = (options || {}).expires;

    // TODO: support flags, support version (CAS)
    this.incrSeq();
    const expiration = makeExpiration(expires || this.options.expires);
    const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);

    const opcode: constants.OP = 1;
    const serialized = this.serializer.serialize(opcode, value, extras);

    const request = Utils.encodeRequest({
      header: {
        opcode: constants.OP_SET,
        opaque: this.seq,
        cas: options.cas,
      },
      key,
      value: serialized.value,
      extras: serialized.extras,
    });
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        default:
          const errorMessage =
            "MemJS SET: " + errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
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
   *
   * The callback signature is:
   *
   *     callback(err, success)
   * @param key
   * @param value
   * @param options
   * @param callback
   */
  add(
    key: string,
    value: Value,
    options?: { expires?: number }
  ): Promise<boolean | null>;
  add(
    key: string,
    value: Value,
    options: { expires?: number },
    callback: (error: Error | null, success: boolean | null) => void
  ): void;
  add(
    key: string,
    value: Value,
    options?: { expires?: number },
    callback?: (error: Error | null, success: boolean | null) => void
  ): Promise<boolean | null> | void {
    if (callback === undefined && options !== "function") {
      if (!options) options = {};
      return promisify((callback) => {
        this.add(key, value, options as { expires?: number }, function (
          err,
          success
        ) {
          callback(err, success);
        });
      });
    }
    const logger = this.options.logger;

    // TODO: support flags, support version (CAS)
    this.incrSeq();
    const expiration = makeExpiration(
      (options || {}).expires || this.options.expires
    );
    const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);

    const opcode: constants.OP = 2;
    const serialized = this.serializer.serialize(opcode, value, extras);
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        case constants.RESPONSE_STATUS_KEY_EXISTS:
          if (callback) {
            callback(null, false);
          }
          break;
        default:
          const errorMessage =
            "MemJS ADD: " + errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage, false);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
  }

  /**
   * REPLACE
   *
   * Replaces the given _key_ and _value_ to memcache. The operation only succeeds
   * if the key is already present.
   *
   * The options dictionary takes:
   * * _expires_: overrides the default expiration (see `Client.create`) for this
   *              particular key-value pair.
   *
   * The callback signature is:
   *
   *     callback(err, success)
   * @param key
   * @param value
   * @param options
   * @param callback
   */
  replace(
    key: string,
    value: Value,
    options?: { expires?: number },
    callback?: (error: Error | null, success: boolean | null) => void
  ): Promise<boolean | null> | void {
    if (callback === undefined && options !== "function") {
      if (!options) options = {};
      return promisify((callback) => {
        this.replace(key, value, options as { expires?: number }, function (
          err,
          success
        ) {
          callback(err, success);
        });
      });
    }
    const logger = this.options.logger;

    // TODO: support flags, support version (CAS)
    this.incrSeq();
    const expiration = makeExpiration(
      (options || {}).expires || this.options.expires
    );
    const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);

    const opcode: constants.OP = 3;
    const serialized = this.serializer.serialize(opcode, value, extras);
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            callback(null, false);
          }
          break;
        default:
          const errorMessage =
            "MemJS REPLACE: " +
            errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage, false);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
  }

  /**
   * DELETE
   *
   * Deletes the given _key_ from memcache. The operation only succeeds
   * if the key is already present.
   *
   * The callback signature is:
   *
   *     callback(err, success)
   * @param key
   * @param callback
   */
  delete(key: string): Promise<boolean>;
  delete(
    key: string,
    callback: (err: Error | null, success: boolean | null) => void
  ): void;
  delete(
    key: string,
    callback?: (err: Error | null, success: boolean | null) => void
  ): Promise<boolean> | void {
    if (callback === undefined) {
      return promisify((callback) => {
        this.delete(key, function (err, success) {
          callback(err, Boolean(success));
        });
      });
    }
    // TODO: Support version (CAS)
    const logger = this.options.logger;
    this.incrSeq();
    const request = makeRequestBuffer(4, key, "", "", this.seq);
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            callback(null, false);
          }
          break;
        default:
          const errorMessage =
            "MemJS DELETE: " + errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage, false);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
  }

  /**
   * INCREMENT
   *
   * Increments the given _key_ in memcache.
   *
   * The options dictionary takes:
   * * _initial_: the value for the key if not already present, defaults to 0.
   * * _expires_: overrides the default expiration (see `Client.create`) for this
   *              particular key-value pair.
   *
   * The callback signature is:
   *
   *     callback(err, success, value)
   * @param key
   * @param amount
   * @param options
   * @param callback
   */
  increment(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number }
  ): Promise<{ value: number | null; success: boolean | null }>;
  increment(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number },
    callback: (
      error: Error | null,
      success: boolean | null,
      value?: number | null
    ) => void
  ): void;
  increment(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number },
    callback?: (
      error: Error | null,
      success: boolean | null,
      value?: number | null
    ) => void
  ): Promise<{ value: number | null; success: boolean | null }> | void {
    if (callback === undefined && options !== "function") {
      return promisify((callback) => {
        if (!options) options = {};
        this.increment(key, amount, options, function (err, success, value) {
          callback(err, { success: success, value: value || null });
        });
      });
    }
    const logger = this.options.logger;

    // TODO: support version (CAS)
    this.incrSeq();
    const initial = options.initial || 0;
    const expires = options.expires || this.options.expires;
    const extras = makeAmountInitialAndExpiration(amount, initial, expires);
    const request = makeRequestBuffer(5, key, extras, "", this.seq);
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          const bufInt =
            (response!.val.readUInt32BE(0) << 8) +
            response!.val.readUInt32BE(4);
          if (callback) {
            callback(null, true, bufInt);
          }
          break;
        default:
          const errorMessage =
            "MemJS INCREMENT: " +
            errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null, null);
          }
      }
    });
  }

  // DECREMENT
  //
  // Decrements the given _key_ in memcache.
  //
  // The options dictionary takes:
  // * _initial_: the value for the key if not already present, defaults to 0.
  // * _expires_: overrides the default expiration (see `Client.create`) for this
  //              particular key-value pair.
  //
  // The callback signature is:
  //
  //     callback(err, success, value)
  decrement(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number }
  ): Promise<{ value: number | null; success: boolean | null }>;
  decrement(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number },
    callback: (
      error: Error | null,
      success: boolean | null,
      value?: number | null
    ) => void
  ): void;
  decrement(
    key: string,
    amount: number,
    options: { initial?: number; expires?: number },
    callback?: (
      error: Error | null,
      success: boolean | null,
      value?: number | null
    ) => void
  ): Promise<{ value: number | null; success: boolean | null }> | void {
    if (callback === undefined && options !== "function") {
      return promisify((callback) => {
        this.decrement(key, amount, options, function (err, success, value) {
          callback(err, { success: success, value: value || null });
        });
      });
    }
    // TODO: support version (CAS)
    const logger = this.options.logger;

    this.incrSeq();
    const initial = options.initial || 0;
    const expires = options.expires || this.options.expires;
    const extras = makeAmountInitialAndExpiration(amount, initial, expires);
    const request = makeRequestBuffer(6, key, extras, "", this.seq);
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          const bufInt =
            (response!.val.readUInt32BE(0) << 8) +
            response!.val.readUInt32BE(4);
          if (callback) {
            callback(null, true, bufInt);
          }
          break;
        default:
          const errorMessage =
            "MemJS DECREMENT: " +
            errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null, null);
          }
      }
    });
  }

  /**
   * APPEND
   *
   * Append the given _value_ to the value associated with the given _key_ in
   * memcache. The operation only succeeds if the key is already present. The
   * callback signature is:
   *
   *     callback(err, success)
   * @param key
   * @param value
   * @param callback
   */
  append(key: string, value: Value): Promise<boolean>;
  append(
    key: string,
    value: Value,
    callback: (err: Error | null, success: boolean | null) => void
  ): void;
  append(
    key: string,
    value: Value,
    callback?: (err: Error | null, success: boolean | null) => void
  ) {
    if (callback === undefined) {
      return promisify((callback) => {
        this.append(key, value, function (err, success) {
          callback(err, success);
        });
      });
    }
    // TODO: support version (CAS)
    const logger = this.options.logger;
    this.incrSeq();
    const opcode: constants.OP = 0x0e;
    const serialized = this.serializer.serialize(opcode, value, "");
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            callback(null, false);
          }
          break;
        default:
          const errorMessage =
            "MemJS APPEND: " + errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
  }

  /**
   * PREPEND
   *
   * Prepend the given _value_ to the value associated with the given _key_ in
   * memcache. The operation only succeeds if the key is already present. The
   * callback signature is:
   *
   *     callback(err, success)
   * @param key
   * @param value
   * @param callback
   */
  prepend(key: string, value: Value): Promise<boolean>;
  prepend(
    key: string,
    value: Value,
    callback: (err: Error | null, success: boolean | null) => void
  ): void;
  prepend(
    key: string,
    value: Value,
    callback?: (err: Error | null, success: boolean | null) => void
  ) {
    if (callback === undefined) {
      return promisify((callback) => {
        this.prepend(key, value, function (err, success) {
          callback(err, success);
        });
      });
    }
    // TODO: support version (CAS)
    const logger = this.options.logger;
    this.incrSeq();

    const opcode: constants.OP =
      constants.OP_PREPEND; /* WAS WRONG IN ORIGINAL */
    const serialized = this.serializer.serialize(opcode, value, "");
    const request = makeRequestBuffer(
      opcode,
      key,
      serialized.extras,
      serialized.value,
      this.seq
    );
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            callback(null, false);
          }
          break;
        default:
          const errorMessage =
            "MemJS PREPEND: " +
            errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
  }

  /**
   * TOUCH
   *
   * Touch sets an expiration value, given by _expires_, on the given _key_ in
   * memcache. The operation only succeeds if the key is already present. The
   * callback signature is:
   *
   *     callback(err, success)
   * @param key
   * @param expires
   * @param callback
   */
  touch(key: string, expires: number): Promise<boolean>;
  touch(
    key: string,
    expires: number,
    callback: (err: Error | null, success: boolean | null) => void
  ): void;
  touch(
    key: string,
    expires: number,
    callback?: (err: Error | null, success: boolean | null) => void
  ): Promise<boolean> | void {
    if (callback === undefined) {
      return promisify((callback) => {
        this.touch(key, expires, function (err, success) {
          callback(err, Boolean(success));
        });
      });
    }
    // TODO: support version (CAS)
    const logger = this.options.logger;
    this.incrSeq();
    const extras = makeExpiration(expires || this.options.expires);
    const request = makeRequestBuffer(0x1c, key, extras, "", this.seq);
    this.perform(key, request, this.seq, function (err, response) {
      if (err) {
        if (callback) {
          callback(err, null);
        }
        return;
      }
      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          if (callback) {
            callback(null, true);
          }
          break;
        case constants.RESPONSE_STATUS_KEY_NOT_FOUND:
          if (callback) {
            callback(null, false);
          }
          break;
        default:
          const errorMessage =
            "MemJS TOUCH: " + errors[response!.header.status || UNKNOWN_ERROR];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null);
          }
      }
    });
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
    const logger = this.options.logger;
    this.incrSeq();
    const request = makeRequestBuffer(0x10, key, "", "", this.seq);

    const handleStats = function (seq: number, serv: Server) {
      const result: Record<string, string> = {};
      const handle: OnResponseCallback = function (response) {
        // end of stat responses
        if (response.header.totalBodyLength === 0) {
          if (callback) {
            callback(null, serv.hostportString(), result);
          }
          return;
        }
        // process single stat line response
        switch (response.header.status) {
          case constants.RESPONSE_STATUS_SUCCCESS:
            result[response.key.toString()] = response.val.toString();
            break;
          default:
            const errorMessage =
              "MemJS STATS (" +
              key +
              "): " +
              errors[response.header.status || UNKNOWN_ERROR];
            logger.log(errorMessage, false);
            if (callback) {
              callback(new Error(errorMessage), serv.hostportString(), null);
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

  _version(
    server: Server
  ): Promise<{ value: Value | null; flags: Extras | null }>;
  _version(
    server: Server,
    callback: (
      error: Error | null,
      value: Value | null,
      flags: Extras | null
    ) => void
  ): void;
  _version(
    server: Server,
    callback?: (
      error: Error | null,
      value: Value | null,
      extras: Extras | null
    ) => void
  ): Promise<{ value: Value | null; flags: Extras | null }> | void {
    if (callback === undefined) {
      return promisify((callback) => {
        this._version(server, function (err, value, flags) {
          callback(err, { value: value, flags: flags });
        });
      });
    }

    this.incrSeq();
    const request = makeRequestBuffer(
      constants.OP_VERSION,
      "",
      "",
      "",
      this.seq
    );
    const logger = this.options.logger;

    this.performOnServer(server, request, this.seq, (err, response) => {
      if (err) {
        if (callback) {
          callback(err, null, null);
        }
        return;
      }

      switch (response!.header.status) {
        case constants.RESPONSE_STATUS_SUCCCESS:
          /* TODO: this is bugged, we should't use the deserializer here, since version always returns a version string.
             The deserializer should only be used on user key data. */
          const deserialized = this.serializer.deserialize(
            response!.header.opcode,
            response!.val,
            response!.extras
          );
          callback(null, deserialized.value, deserialized.extras);
          break;
        default:
          const errorMessage =
            "MemJS VERSION: " +
            errors[(response!.header.status, UNKNOWN_ERROR)];
          logger.log(errorMessage);
          if (callback) {
            callback(new Error(errorMessage), null, null);
          }
      }
    });
  }

  /**
   * VERSION
   *
   * Request the server version from the "first" server in the backend pool.
   *
   * The server responds with a packet containing the version string in the body with the following format: "x.y.z"
   */
  version(): Promise<{ value: Value | null; flags: Extras | null }>;
  version(
    callback: (
      error: Error | null,
      value: Value | null,
      flags: Extras | null
    ) => void
  ): void;
  version(
    callback?: (
      error: Error | null,
      value: Value | null,
      extras: Extras | null
    ) => void
  ) {
    const server = this.serverKeyToServer(this.serverKeys[0]);
    if (callback) {
      this._version(server, callback);
    } else {
      return this._version(server);
    }
  }

  /**
   * VERSION-ALL
   *
   * Retrieves the server version from all the servers
   * in the backend pool, errors if any one of them has an
   * error
   *
   * The callback signature is:
   *
   *     callback(err, value, flags)
   *
   * @param keys
   * @param callback
   */
  versionAll(): Promise<{
    values: Record<string, Value | null>;
  }>;
  versionAll(
    callback: (
      err: Error | null,
      values: Record<string, Value | null> | null
    ) => void
  ): void;
  versionAll(
    callback?: (
      err: Error | null,
      values: Record<string, Value | null> | null
    ) => void
  ): Promise<{
    values: Record<string, Value | null>;
  }> | void {
    const promise = Promise.all(
      this.serverKeys.map((serverKey) => {
        const server = this.serverKeyToServer(serverKey);

        return this._version(server).then((response) => {
          return { serverKey: serverKey, value: response.value };
        });
      })
    ).then((versionObjects) => {
      const values = versionObjects.reduce((accumulator, versionObject) => {
        accumulator[versionObject.serverKey] = versionObject.value;
        return accumulator;
      }, {} as Record<string, Value | null>);
      return { values: values };
    });

    if (callback === undefined) {
      return promise;
    }
    promise
      .then((response) => {
        callback(null, response.values);
      })
      .catch((err) => {
        callback(err, null);
      });
  }

  /**
   * CLOSE
   *
   * Closes (abruptly) connections to all the servers.
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
   * @param {*} callback a callback invoked when a response is received or the request fails
   * @param {*} retries number of times to retry request on failure
   */
  perform(
    key: string,
    request: Buffer,
    seq: number,
    callback: ResponseOrErrorCallback,
    retries?: number
  ) {
    const serverKey = this.lookupKeyToServerKey(key);

    const server = this.serverKeyToServer(serverKey);

    if (!server) {
      if (callback) {
        callback(new Error("No servers available"), null);
      }
      return;
    }
    return this.performOnServer(server, request, seq, callback, retries);
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
}

export { Client, Server, Utils, Header };
