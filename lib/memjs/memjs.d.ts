/// <reference types="node" />
import { Server, ServerOptions } from "./server";
import { Serializer } from "./noop-serializer";
import { MaybeBuffer, Message } from "./utils";
import * as Utils from "./utils";
import * as Header from "./header";
declare function defaultKeyToServerHashFunction(servers: string[], key: string): string;
declare type ResponseOrErrorCallback = (error: Error | null, response: Message | null) => void;
interface BaseClientOptions {
    retries: number;
    retry_delay: number;
    expires: number;
    logger: {
        log: typeof console.log;
    };
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
declare type IfBuffer<Value, Extras, WhenValueAndExtrasAreBuffers, NotBuffer> = Value extends Buffer ? Extras extends Buffer ? WhenValueAndExtrasAreBuffers : NotBuffer : NotBuffer;
export declare type GivenClientOptions<Value, Extras> = Partial<BaseClientOptions> & IfBuffer<Value, Extras, Partial<SerializerProp<Value, Extras>>, SerializerProp<Value, Extras>>;
export declare type CASToken = Buffer;
export interface GetResult<Value = MaybeBuffer, Extras = MaybeBuffer> {
    value: Value;
    extras: Extras;
    cas: CASToken | undefined;
}
export declare type GetMultiResult<Keys extends string = string, Value = MaybeBuffer, Extras = MaybeBuffer> = {
    [K in Keys]?: GetResult<Value, Extras>;
};
declare class Client<Value = MaybeBuffer, Extras = MaybeBuffer> {
    servers: Server[];
    seq: number;
    options: BaseClientOptions & Partial<SerializerProp<Value, Extras>>;
    serializer: Serializer<Value, Extras>;
    serverMap: {
        [hostport: string]: Server;
    };
    serverKeys: string[];
    constructor(servers: Server[], options: GivenClientOptions<Value, Extras>);
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
    static create<Value, Extras>(serversStr: string | undefined, options: IfBuffer<Value, Extras, undefined | (Partial<ServerOptions> & GivenClientOptions<Value, Extras>), Partial<ServerOptions> & GivenClientOptions<Value, Extras>>): Client<Value, Extras>;
    /**
     * Given a serverKey fromlookupKeyToServerKey, return the corresponding Server instance
     *
     * @param  {string} serverKey
     * @returns {Server}
     */
    serverKeyToServer(serverKey: string): Server;
    /**
     * Given a key to look up in memcache, return a serverKey (based on some
     * hashing function) which can be used to index this.serverMap
     */
    lookupKeyToServerKey(key: string): string;
    /**
     * Retrieves the value at the given key in memcache.
     */
    get(key: string): Promise<GetResult<Value, Extras> | null>;
    /** Build a pipelined get multi request by sending one GETKQ for each key (quiet, meaning it won't respond if the value is missing) followed by a no-op to force a response (and to give us a sentinel response that the pipeline is done)
     *
     * cf https://github.com/couchbase/memcached/blob/master/docs/BinaryProtocol.md#0x0d-getkq-get-with-key-quietly
     */
    _buildGetMultiRequest(keys: string[]): Buffer;
    /** Executing a pipelined (multi) get against a single server. This is a private implementation detail of getMulti. */
    _getMultiToServer<Keys extends string>(serv: Server, keys: Keys[]): Promise<GetMultiResult<Keys, Value, Extras>>;
    /**
     * Retrievs the value at the given keys in memcached. Returns a map from the
     * requested keys to results, or null if the key was not found.
     */
    getMulti<Keys extends string>(keys: Keys[]): Promise<GetMultiResult<Keys, Value, Extras> | null>;
    /**
     * Sets `key` to `value`.
     */
    set(key: string, value: Value, options?: {
        expires?: number;
        cas?: CASToken;
    }): Promise<boolean | null>;
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
    add(key: string, value: Value, options?: {
        expires?: number;
    }): Promise<boolean | null>;
    /**
     * Replaces the given _key_ and _value_ to memcache. The operation only succeeds
     * if the key is already present.
     */
    replace(key: string, value: Value, options?: {
        expires?: number;
    }): Promise<boolean | null>;
    /**
     * Deletes the given _key_ from memcache. The operation only succeeds
     * if the key is already present.
     */
    delete(key: string): Promise<boolean>;
    /**
     * Increments the given _key_ in memcache.
     */
    increment(key: string, amount: number, options?: {
        initial?: number;
        expires?: number;
    }): Promise<{
        value: number | null;
        success: boolean | null;
    }>;
    /**
     * Decrements the given `key` in memcache.
     */
    decrement(key: string, amount: number, options: {
        initial?: number;
        expires?: number;
    }): Promise<{
        value: number | null;
        success: boolean | null;
    }>;
    /**
     * Append the given _value_ to the value associated with the given _key_ in
     * memcache. The operation only succeeds if the key is already present.
     */
    append(key: string, value: Value): Promise<boolean>;
    /**
     * Prepend the given _value_ to the value associated with the given _key_ in
     * memcache. The operation only succeeds if the key is already present.
     */
    prepend(key: string, value: Value): Promise<boolean>;
    /**
     * Touch sets an expiration value, given by _expires_, on the given _key_ in
     * memcache. The operation only succeeds if the key is already present.
     */
    touch(key: string, expires: number): Promise<boolean>;
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
    flush(callback: (err: Error | null, results: Record<string, boolean | Error>) => void): void;
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
    statsWithKey(key: string, callback?: (err: Error | null, server: string, stats: Record<string, string> | null) => void): void;
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
    stats(callback?: (err: Error | null, server: string, stats: Record<string, string> | null) => void): void;
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
    resetStats(callback?: (err: Error | null, server: string, stats: Record<string, string> | null) => void): void;
    /**
     * QUIT
     *
     * Closes the connection to each server, notifying them of this intention. Note
     * that quit can race against already outstanding requests when those requests
     * fail and are retried, leading to the quit command winning and closing the
     * connection before the retries complete.
     */
    quit(): void;
    _version(server: Server): Promise<{
        value: Value | null;
    }>;
    /**
     * Request the server version from the "first" server in the backend pool.
     * The server responds with a packet containing the version string in the body with the following format: "x.y.z"
     */
    version(): Promise<{
        value: Value | null;
    }>;
    /**
     * Retrieves the server version from all the servers
     * in the backend pool, errors if any one of them has an
     * error
     */
    versionAll(): Promise<{
        values: Record<string, Value | null>;
    }>;
    /**
     * Closes (abruptly) connections to all the servers.
     * @see this.quit
     */
    close(): void;
    /**
     * Perform a generic single response operation (get, set etc) on one server
     *
     * @param {string} key the key to hash to get a server from the pool
     * @param {buffer} request a buffer containing the request
     * @param {number} seq the sequence number of the operation. It is used to pin the callbacks
                           to a specific operation and should never change during a `perform`.
     * @param {number?} retries number of times to retry request on failure
     */
    perform(key: string, request: Buffer, seq: number, retries?: number): Promise<Message>;
    performOnServer(server: Server, request: Buffer, seq: number, callback: ResponseOrErrorCallback, retries?: number): void;
    incrSeq(): void;
    private createAndLogError;
    /**
     * Log an error to the logger, then return the error.
     * If a callback is given, call it with callback(error, null).
     */
    private handleResponseError;
}
export { Client, Server, Utils, Header };
//# sourceMappingURL=memjs.d.ts.map