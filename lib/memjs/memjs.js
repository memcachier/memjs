"use strict";
// MemTS Memcache Client
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Header = exports.Utils = exports.Server = exports.Client = void 0;
const server_1 = require("./server");
Object.defineProperty(exports, "Server", { enumerable: true, get: function () { return server_1.Server; } });
const noop_serializer_1 = require("./noop-serializer");
const utils_1 = require("./utils");
const constants = __importStar(require("./constants"));
const constants_1 = require("./constants");
const Utils = __importStar(require("./utils"));
exports.Utils = Utils;
const Header = __importStar(require("./header"));
exports.Header = Header;
function defaultKeyToServerHashFunction(servers, key) {
    const total = servers.length;
    const index = total > 1 ? utils_1.hashCode(key) % total : 0;
    return servers[index];
}
// converts a call into a promise-returning one
function promisify(command) {
    return new Promise(function (resolve, reject) {
        command(function (err, result) {
            err ? reject(err) : resolve(result);
        });
    });
}
class Client {
    // Client initializer takes a list of `Server`s and an `options` dictionary.
    // See `Client.create` for details.
    constructor(servers, options) {
        this.servers = servers;
        this.seq = 0;
        this.options = utils_1.merge(options || {}, {
            retries: 2,
            retry_delay: 0.2,
            expires: 0,
            logger: console,
            keyToServerHashFunction: defaultKeyToServerHashFunction,
        });
        this.serializer = this.options.serializer || noop_serializer_1.noopSerializer;
        // Store a mapping from hostport -> server so we can quickly get a server object from the serverKey returned by the hashing function
        const serverMap = {};
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
    static create(serversStr, options) {
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
            return new server_1.Server(hostPort[0], parseInt(hostPort[1] || "11211", 10), userPass[0], userPass[1], options);
        });
        return new Client(servers, options);
    }
    /**
     * Given a serverKey fromlookupKeyToServerKey, return the corresponding Server instance
     *
     * @param  {string} serverKey
     * @returns {Server}
     */
    serverKeyToServer(serverKey) {
        return this.serverMap[serverKey];
    }
    /**
     * Given a key to look up in memcache, return a serverKey (based on some
     * hashing function) which can be used to index this.serverMap
     */
    lookupKeyToServerKey(key) {
        return this.options.keyToServerHashFunction(this.serverKeys, key);
    }
    /**
     * Retrieves the value at the given key in memcache.
     */
    async get(key) {
        this.incrSeq();
        const request = utils_1.makeRequestBuffer(constants.OP_GET, key, "", "", this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                const deserialized = this.serializer.deserialize(response.header.opcode, response.val, response.extras);
                return { ...deserialized, cas: response.header.cas };
            case constants_1.ResponseStatus.KEY_NOT_FOUND:
                return null;
            default:
                throw this.createAndLogError("GET", response.header.status);
        }
    }
    /** Build a pipelined get multi request by sending one GETKQ for each key (quiet, meaning it won't respond if the value is missing) followed by a no-op to force a response (and to give us a sentinel response that the pipeline is done)
     *
     * cf https://github.com/couchbase/memcached/blob/master/docs/BinaryProtocol.md#0x0d-getkq-get-with-key-quietly
     */
    _buildGetMultiRequest(keys) {
        // start at 24 for the no-op command at the end
        let requestSize = 24;
        for (const keyIdx in keys) {
            requestSize += Buffer.byteLength(keys[keyIdx], "utf8") + 24;
        }
        const request = Buffer.alloc(requestSize);
        let bytesWritten = 0;
        for (const keyIdx in keys) {
            const key = keys[keyIdx];
            bytesWritten += utils_1.copyIntoRequestBuffer(constants.OP_GETKQ, key, "", "", this.seq, request, bytesWritten);
        }
        bytesWritten += utils_1.copyIntoRequestBuffer(constants.OP_NO_OP, "", "", "", this.seq, request, bytesWritten);
        return request;
    }
    /** Executing a pipelined (multi) get against a single server. This is a private implementation detail of getMulti. */
    async _getMultiToServer(serv, keys) {
        return new Promise((resolve, reject) => {
            const responseMap = {};
            const handle = (response) => {
                switch (response.header.status) {
                    case constants_1.ResponseStatus.SUCCESS:
                        // When we get the no-op response, we are done with this one getMulti in the per-backend fan-out
                        if (response.header.opcode === constants.OP_NO_OP) {
                            // This ensures the handler will be deleted from the responseCallbacks map in server.js
                            // This isn't technically needed here because the logic in server.js also checks if totalBodyLength === 0, but our unittests aren't great about setting that field, and also this makes it more explicit
                            handle.quiet = false;
                            resolve(responseMap);
                        }
                        else {
                            const deserialized = this.serializer.deserialize(response.header.opcode, response.val, response.extras);
                            const key = response.key.toString();
                            responseMap[key] = { ...deserialized, cas: response.header.cas };
                        }
                        break;
                    default:
                        return reject(this.createAndLogError("GET", response.header.status));
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
    async getMulti(keys) {
        const serverKeytoLookupKeys = {};
        keys.forEach((lookupKey) => {
            const serverKey = this.lookupKeyToServerKey(lookupKey);
            if (!serverKeytoLookupKeys[serverKey]) {
                serverKeytoLookupKeys[serverKey] = [];
            }
            serverKeytoLookupKeys[serverKey].push(lookupKey);
        });
        const usedServerKeys = Object.keys(serverKeytoLookupKeys);
        const results = await Promise.all(usedServerKeys.map((serverKey) => {
            const server = this.serverKeyToServer(serverKey);
            return this._getMultiToServer(server, serverKeytoLookupKeys[serverKey]);
        }));
        return Object.assign({}, ...results);
    }
    /**
     * Sets `key` to `value`.
     */
    async set(key, value, options) {
        const expires = options === null || options === void 0 ? void 0 : options.expires;
        const cas = options === null || options === void 0 ? void 0 : options.cas;
        // TODO: support flags
        this.incrSeq();
        const expiration = utils_1.makeExpiration(expires || this.options.expires);
        const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);
        const serialized = this.serializer.serialize(constants.OP_SET, value, extras);
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
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_EXISTS:
                if (cas) {
                    return false;
                }
                else {
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
    async add(key, value, options) {
        // TODO: support flags, support version (CAS)
        this.incrSeq();
        const expiration = utils_1.makeExpiration((options === null || options === void 0 ? void 0 : options.expires) || this.options.expires);
        const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);
        const opcode = constants.OP_ADD;
        const serialized = this.serializer.serialize(opcode, value, extras);
        const request = utils_1.makeRequestBuffer(opcode, key, serialized.extras, serialized.value, this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_EXISTS:
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
    async replace(key, value, options) {
        // TODO: support flags, support version (CAS)
        this.incrSeq();
        const expiration = utils_1.makeExpiration((options === null || options === void 0 ? void 0 : options.expires) || this.options.expires);
        const extras = Buffer.concat([Buffer.from("00000000", "hex"), expiration]);
        const opcode = constants.OP_REPLACE;
        const serialized = this.serializer.serialize(opcode, value, extras);
        const request = utils_1.makeRequestBuffer(opcode, key, serialized.extras, serialized.value, this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_NOT_FOUND:
                return false;
            default:
                throw this.createAndLogError("REPLACE", response.header.status);
        }
    }
    /**
     * Deletes the given _key_ from memcache. The operation only succeeds
     * if the key is already present.
     */
    async delete(key) {
        // TODO: Support version (CAS)
        this.incrSeq();
        const request = utils_1.makeRequestBuffer(4, key, "", "", this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_NOT_FOUND:
                return false;
            default:
                throw this.createAndLogError("DELETE", response === null || response === void 0 ? void 0 : response.header.status);
        }
    }
    /**
     * Increments the given _key_ in memcache.
     */
    async increment(key, amount, options) {
        // TODO: support version (CAS)
        this.incrSeq();
        const initial = (options === null || options === void 0 ? void 0 : options.initial) || 0;
        const expires = (options === null || options === void 0 ? void 0 : options.expires) || this.options.expires;
        const extras = utils_1.makeAmountInitialAndExpiration(amount, initial, expires);
        const request = utils_1.makeRequestBuffer(constants.OP_INCREMENT, key, extras, "", this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                const bufInt = (response.val.readUInt32BE(0) << 8) + response.val.readUInt32BE(4);
                return { value: bufInt, success: true };
            default:
                throw this.createAndLogError("INCREMENT", response.header.status);
        }
    }
    /**
     * Decrements the given `key` in memcache.
     */
    async decrement(key, amount, options) {
        // TODO: support version (CAS)
        this.incrSeq();
        const initial = options.initial || 0;
        const expires = options.expires || this.options.expires;
        const extras = utils_1.makeAmountInitialAndExpiration(amount, initial, expires);
        const request = utils_1.makeRequestBuffer(constants.OP_DECREMENT, key, extras, "", this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                const bufInt = (response.val.readUInt32BE(0) << 8) + response.val.readUInt32BE(4);
                return { value: bufInt, success: true };
            default:
                throw this.createAndLogError("DECREMENT", response.header.status);
        }
    }
    /**
     * Append the given _value_ to the value associated with the given _key_ in
     * memcache. The operation only succeeds if the key is already present.
     */
    async append(key, value) {
        // TODO: support version (CAS)
        this.incrSeq();
        const opcode = constants.OP_APPEND;
        const serialized = this.serializer.serialize(opcode, value, "");
        const request = utils_1.makeRequestBuffer(opcode, key, serialized.extras, serialized.value, this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_NOT_FOUND:
                return false;
            default:
                throw this.createAndLogError("APPEND", response.header.status);
        }
    }
    /**
     * Prepend the given _value_ to the value associated with the given _key_ in
     * memcache. The operation only succeeds if the key is already present.
     */
    async prepend(key, value) {
        // TODO: support version (CAS)
        this.incrSeq();
        const opcode = constants.OP_PREPEND;
        const serialized = this.serializer.serialize(opcode, value, "");
        const request = utils_1.makeRequestBuffer(opcode, key, serialized.extras, serialized.value, this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_NOT_FOUND:
                return false;
            default:
                throw this.createAndLogError("PREPEND", response.header.status);
        }
    }
    /**
     * Touch sets an expiration value, given by _expires_, on the given _key_ in
     * memcache. The operation only succeeds if the key is already present.
     */
    async touch(key, expires) {
        // TODO: support version (CAS)
        this.incrSeq();
        const extras = utils_1.makeExpiration(expires || this.options.expires);
        const request = utils_1.makeRequestBuffer(0x1c, key, extras, "", this.seq);
        const response = await this.perform(key, request, this.seq);
        switch (response.header.status) {
            case constants_1.ResponseStatus.SUCCESS:
                return true;
            case constants_1.ResponseStatus.KEY_NOT_FOUND:
                return false;
            default:
                throw this.createAndLogError("TOUCH", response.header.status);
        }
    }
    flush(callback) {
        if (callback === undefined) {
            return promisify((callback) => {
                this.flush(function (err, results) {
                    callback(err, results);
                });
            });
        }
        // TODO: support expiration
        this.incrSeq();
        const request = utils_1.makeRequestBuffer(0x08, "", "", "", this.seq);
        let count = this.servers.length;
        const result = {};
        let lastErr = null;
        const handleFlush = function (seq, serv) {
            serv.onResponse(seq, function ( /* response */) {
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
    statsWithKey(key, callback) {
        this.incrSeq();
        const request = utils_1.makeRequestBuffer(0x10, key, "", "", this.seq);
        const handleStats = (seq, serv) => {
            const result = {};
            const handle = (response) => {
                // end of stat responses
                if (response.header.totalBodyLength === 0) {
                    if (callback) {
                        callback(null, serv.hostportString(), result);
                    }
                    return;
                }
                // process single stat line response
                switch (response.header.status) {
                    case constants_1.ResponseStatus.SUCCESS:
                        result[response.key.toString()] = response.val.toString();
                        break;
                    default:
                        const error = this.handleResponseError(`STATS (${key})`, response.header.status, undefined);
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
    stats(callback) {
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
    resetStats(callback) {
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
        const request = utils_1.makeRequestBuffer(0x07, "", "", "", this.seq); // QUIT
        let serv;
        const handleQuit = function (seq, serv) {
            serv.onResponse(seq, function ( /* response */) {
                serv.close();
            });
            serv.onError(seq, function ( /* err */) {
                serv.close();
            });
            serv.write(request);
        };
        for (let i = 0; i < this.servers.length; i++) {
            serv = this.servers[i];
            handleQuit(this.seq, serv);
        }
    }
    _version(server) {
        return new Promise((resolve, reject) => {
            this.incrSeq();
            const request = utils_1.makeRequestBuffer(constants.OP_VERSION, "", "", "", this.seq);
            this.performOnServer(server, request, this.seq, (err, response) => {
                if (err) {
                    return reject(err);
                }
                switch (response.header.status) {
                    case constants_1.ResponseStatus.SUCCESS:
                        /* TODO: this is bugged, we should't use the deserializer here, since version always returns a version string.
                         The deserializer should only be used on user key data. */
                        const deserialized = this.serializer.deserialize(response.header.opcode, response.val, response.extras);
                        return resolve({ value: deserialized.value });
                    default:
                        return reject(this.createAndLogError("VERSION", response.header.status));
                }
            });
        });
    }
    /**
     * Request the server version from the "first" server in the backend pool.
     * The server responds with a packet containing the version string in the body with the following format: "x.y.z"
     */
    version() {
        const server = this.serverKeyToServer(this.serverKeys[0]);
        return this._version(server);
    }
    /**
     * Retrieves the server version from all the servers
     * in the backend pool, errors if any one of them has an
     * error
     */
    async versionAll() {
        const versionObjects = await Promise.all(this.serverKeys.map((serverKey) => {
            const server = this.serverKeyToServer(serverKey);
            return this._version(server).then((response) => {
                return { serverKey: serverKey, value: response.value };
            });
        }));
        const values = versionObjects.reduce((accumulator, versionObject) => {
            accumulator[versionObject.serverKey] = versionObject.value;
            return accumulator;
        }, {});
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
    perform(key, request, seq, retries) {
        return new Promise((resolve, reject) => {
            const serverKey = this.lookupKeyToServerKey(key);
            const server = this.serverKeyToServer(serverKey);
            if (!server) {
                return reject(new Error("No servers available"));
            }
            this.performOnServer(server, request, seq, (error, response) => {
                if (error) {
                    return reject(error);
                }
                resolve(response);
            }, retries);
        });
    }
    performOnServer(server, request, seq, callback, retries = 0) {
        const _this = this;
        retries = retries || this.options.retries;
        const origRetries = this.options.retries;
        const logger = this.options.logger;
        const retry_delay = this.options.retry_delay;
        const responseHandler = function (response) {
            if (callback) {
                callback(null, response);
            }
        };
        const errorHandler = function (error) {
            if (--retries > 0) {
                // Wait for retry_delay
                setTimeout(function () {
                    _this.performOnServer(server, request, seq, callback, retries);
                }, 1000 * retry_delay);
            }
            else {
                logger.log("MemJS: Server <" +
                    server.hostportString() +
                    "> failed after (" +
                    origRetries +
                    ") retries with error - " +
                    error.message);
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
    createAndLogError(commandName, responseStatus) {
        const errorMessage = `MemJS ${commandName}: ${constants.responseStatusToString(responseStatus)}`;
        this.options.logger.log(errorMessage);
        return new Error(errorMessage);
    }
    /**
     * Log an error to the logger, then return the error.
     * If a callback is given, call it with callback(error, null).
     */
    handleResponseError(commandName, responseStatus, callback) {
        const error = this.createAndLogError(commandName, responseStatus);
        if (callback) {
            callback(error, null);
        }
        return error;
    }
}
exports.Client = Client;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVtanMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvbWVtanMvbWVtanMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLHdCQUF3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUV4QixxQ0FLa0I7QUFvaENELHVGQXRoQ2YsZUFBTSxPQXNoQ2U7QUFuaEN2Qix1REFBK0Q7QUFDL0QsbUNBU2lCO0FBQ2pCLHVEQUF5QztBQUN6QywyQ0FBNkM7QUFDN0MsK0NBQWlDO0FBc2dDUixzQkFBSztBQXJnQzlCLGlEQUFtQztBQXFnQ0gsd0JBQU07QUFuZ0N0QyxTQUFTLDhCQUE4QixDQUNyQyxPQUFpQixFQUNqQixHQUFXO0lBRVgsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUM3QixNQUFNLEtBQUssR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hCLENBQUM7QUFFRCwrQ0FBK0M7QUFDL0MsU0FBUyxTQUFTLENBQ2hCLE9BQTBFO0lBRTFFLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxPQUFPLEVBQUUsTUFBTTtRQUMxQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUUsTUFBTTtZQUMzQixHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBNkRELE1BQU0sTUFBTTtJQVFWLDRFQUE0RTtJQUM1RSxtQ0FBbUM7SUFDbkMsWUFBWSxPQUFpQixFQUFFLE9BQTBDO1FBQ3ZFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElB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QyxDQUFDO2lCQUN2QjthQUNGO1FBQ0gsQ0FBQyxDQUFDO1FBRUYsTUFBTSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDeEMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDbEMsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN4QixDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLE9BQU87UUFDTCxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFFWCw2RUFBNkU7UUFDN0UsSUFBSSxDQUFDLEdBQUcsSUFBSSxVQUFVLENBQUM7SUFDekIsQ0FBQztJQUVPLGlCQUFpQixDQUN2QixXQUFtQixFQUNuQixjQUEwQztRQUUxQyxNQUFNLFlBQVksR0FBRyxTQUFTLFdBQVcsS0FBSyxTQUFTLENBQUMsc0JBQXNCLENBQzVFLGNBQWMsQ0FDZixFQUFFLENBQUM7UUFDSixJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdEMsT0FBTyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssbUJBQW1CLENBQ3pCLFdBQW1CLEVBQ25CLGNBQTBDLEVBQzFDLFFBQWtFO1FBRWxFLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDbEUsSUFBSSxRQUFRLEVBQUU7WUFDWixRQUFRLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO1NBQ3ZCO1FBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0NBQ0Y7QUFFUSx3QkFBTSIsInNvdXJjZXNDb250ZW50IjpbIi8vIE1lbVRTIE1lbWNhY2hlIENsaWVudFxuXG5pbXBvcnQge1xuICBPbkVycm9yQ2FsbGJhY2ssXG4gIE9uUmVzcG9uc2VDYWxsYmFjayxcbiAgU2VydmVyLFxuICBTZXJ2ZXJPcHRpb25zLFxufSBmcm9tIFwiLi9zZXJ2ZXJcIjtcbmltcG9ydCB7IG5vb3BTZXJpYWxpemVyLCBTZXJpYWxpemVyIH0gZnJvbSBcIi4vbm9vcC1zZXJpYWxpemVyXCI7XG5pbXBvcnQge1xuICBtYWtlUmVxdWVzdEJ1ZmZlcixcbiAgY29weUludG9SZXF1ZXN0QnVmZmVyLFxuICBtZXJnZSxcbiAgbWFrZUV4cGlyYXRpb24sXG4gIG1ha2VBbW91bnRJbml0aWFsQW5kRXhwaXJhdGlvbixcbiAgaGFzaENvZGUsXG4gIE1heWJlQnVmZmVyLFxuICBNZXNzYWdlLFxufSBmcm9tIFwiLi91dGlsc1wiO1xuaW1wb3J0ICogYXMgY29uc3RhbnRzIGZyb20gXCIuL2NvbnN0YW50c1wiO1xuaW1wb3J0IHsgUmVzcG9uc2VTdGF0dXMgfSBmcm9tIFwiLi9jb25zdGFudHNcIjtcbmltcG9ydCAqIGFzIFV0aWxzIGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgKiBhcyBIZWFkZXIgZnJvbSBcIi4vaGVhZGVyXCI7XG5cbmZ1bmN0aW9uIGRlZmF1bHRLZXlUb1NlcnZlckhhc2hGdW5jdGlvbihcbiAgc2VydmVyczogc3RyaW5nW10sXG4gIGtleTogc3RyaW5nXG4pOiBzdHJpbmcge1xuICBjb25zdCB0b3RhbCA9IHNlcnZlcnMubGVuZ3RoO1xuICBjb25zdCBpbmRleCA9IHRvdGFsID4gMSA/IGhhc2hDb2RlKGtleSkgJSB0b3RhbCA6IDA7XG4gIHJldHVybiBzZXJ2ZXJzW2luZGV4XTtcbn1cblxuLy8gY29udmVydHMgYSBjYWxsIGludG8gYSBwcm9taXNlLXJldHVybmluZyBvbmVcbmZ1bmN0aW9uIHByb21pc2lmeTxSZXN1bHQ+KFxuICBjb21tYW5kOiAoY2FsbGJhY2s6IChlcnJvcjogRXJyb3IgfCBudWxsLCByZXN1bHQ6IFJlc3VsdCkgPT4gdm9pZCkgPT4gdm9pZFxuKTogUHJvbWlzZTxSZXN1bHQ+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICBjb21tYW5kKGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICAgICAgZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKHJlc3VsdCk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG50eXBlIFJlc3BvbnNlT3JFcnJvckNhbGxiYWNrID0gKFxuICBlcnJvcjogRXJyb3IgfCBudWxsLFxuICByZXNwb25zZTogTWVzc2FnZSB8IG51bGxcbikgPT4gdm9pZDtcblxuaW50ZXJmYWNlIEJhc2VDbGllbnRPcHRpb25zIHtcbiAgcmV0cmllczogbnVtYmVyO1xuICByZXRyeV9kZWxheTogbnVtYmVyO1xuICBleHBpcmVzOiBudW1iZXI7XG4gIGxvZ2dlcjogeyBsb2c6IHR5cGVvZiBjb25zb2xlLmxvZyB9O1xuICBrZXlUb1NlcnZlckhhc2hGdW5jdGlvbjogdHlwZW9mIGRlZmF1bHRLZXlUb1NlcnZlckhhc2hGdW5jdGlvbjtcbn1cblxuaW50ZXJmYWNlIFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+IHtcbiAgc2VyaWFsaXplcjogU2VyaWFsaXplcjxWYWx1ZSwgRXh0cmFzPjtcbn1cblxuLyoqXG4gKiBUaGUgY2xpZW50IGhhcyBwYXJ0aWFsIHN1cHBvcnQgZm9yIHNlcmlhbGl6aW5nIGFuZCBkZXNlcmlhbGl6aW5nIHZhbHVlcyBmcm9tIHRoZVxuICogQnVmZmVyIGJ5dGUgc3RyaW5ncyB3ZSByZWNpZXZlIGZyb20gdGhlIHdpcmUuIFRoZSBkZWZhdWx0IHNlcmlhbGl6ZXIgaXMgZm9yIE1heWJlQnVmZmVyLlxuICpcbiAqIElmIFZhbHVlIGFuZCBFeHRyYXMgYXJlIG9mIHR5cGUgQnVmZmVyLCB0aGVuIHJldHVybiB0eXBlIFdoZW5CdWZmZXIuIE90aGVyd2lzZSxcbiAqIHJldHVybiB0eXBlIE5vdEJ1ZmZlci5cbiAqL1xudHlwZSBJZkJ1ZmZlcjxcbiAgVmFsdWUsXG4gIEV4dHJhcyxcbiAgV2hlblZhbHVlQW5kRXh0cmFzQXJlQnVmZmVycyxcbiAgTm90QnVmZmVyXG4+ID0gVmFsdWUgZXh0ZW5kcyBCdWZmZXJcbiAgPyBFeHRyYXMgZXh0ZW5kcyBCdWZmZXJcbiAgICA/IFdoZW5WYWx1ZUFuZEV4dHJhc0FyZUJ1ZmZlcnNcbiAgICA6IE5vdEJ1ZmZlclxuICA6IE5vdEJ1ZmZlcjtcblxuZXhwb3J0IHR5cGUgR2l2ZW5DbGllbnRPcHRpb25zPFZhbHVlLCBFeHRyYXM+ID0gUGFydGlhbDxCYXNlQ2xpZW50T3B0aW9ucz4gJlxuICBJZkJ1ZmZlcjxcbiAgICBWYWx1ZSxcbiAgICBFeHRyYXMsXG4gICAgUGFydGlhbDxTZXJpYWxpemVyUHJvcDxWYWx1ZSwgRXh0cmFzPj4sXG4gICAgU2VyaWFsaXplclByb3A8VmFsdWUsIEV4dHJhcz5cbiAgPjtcblxuZXhwb3J0IHR5cGUgQ0FTVG9rZW4gPSBCdWZmZXI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2V0UmVzdWx0PFZhbHVlID0gTWF5YmVCdWZmZXIsIEV4dHJhcyA9IE1heWJlQnVmZmVyPiB7XG4gIHZhbHVlOiBWYWx1ZTtcbiAgZXh0cmFzOiBFeHRyYXM7XG4gIGNhczogQ0FTVG9rZW4gfCB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCB0eXBlIEdldE11bHRpUmVzdWx0PFxuICBLZXlzIGV4dGVuZHMgc3RyaW5nID0gc3RyaW5nLFxuICBWYWx1ZSA9IE1heWJlQnVmZmVyLFxuICBFeHRyYXMgPSBNYXliZUJ1ZmZlclxuPiA9IHtcbiAgW0sgaW4gS2V5c10/OiBHZXRSZXN1bHQ8VmFsdWUsIEV4dHJhcz47XG59O1xuXG5jbGFzcyBDbGllbnQ8VmFsdWUgPSBNYXliZUJ1ZmZlciwgRXh0cmFzID0gTWF5YmVCdWZmZXI+IHtcbiAgc2VydmVyczogU2VydmVyW107XG4gIHNlcTogbnVtYmVyO1xuICBvcHRpb25zOiBCYXNlQ2xpZW50T3B0aW9ucyAmIFBhcnRpYWw8U2VyaWFsaXplclByb3A8VmFsdWUsIEV4dHJhcz4+O1xuICBzZXJpYWxpemVyOiBTZXJpYWxpemVyPFZhbHVlLCBFeHRyYXM+O1xuICBzZXJ2ZXJNYXA6IHsgW2hvc3Rwb3J0OiBzdHJpbmddOiBTZXJ2ZXIgfTtcbiAgc2VydmVyS2V5czogc3RyaW5nW107XG5cbiAgLy8gQ2xpZW50IGluaXRpYWxpemVyIHRha2VzIGEgbGlzdCBvZiBgU2VydmVyYHMgYW5kIGFuIGBvcHRpb25zYCBkaWN0aW9uYXJ5LlxuICAvLyBTZWUgYENsaWVudC5jcmVhdGVgIGZvciBkZXRhaWxzLlxuICBjb25zdHJ1Y3RvcihzZXJ2ZXJzOiBTZXJ2ZXJbXSwgb3B0aW9uczogR2l2ZW5DbGllbnRPcHRpb25zPFZhbHVlLCBFeHRyYXM+KSB7XG4gICAgdGhpcy5zZXJ2ZXJzID0gc2VydmVycztcbiAgICB0aGlzLnNlcSA9IDA7XG4gICAgdGhpcy5vcHRpb25zID0gbWVyZ2Uob3B0aW9ucyB8fCB7fSwge1xuICAgICAgcmV0cmllczogMixcbiAgICAgIHJldHJ5X2RlbGF5OiAwLjIsXG4gICAgICBleHBpcmVzOiAwLFxuICAgICAgbG9nZ2VyOiBjb25zb2xlLFxuICAgICAga2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb246IGRlZmF1bHRLZXlUb1NlcnZlckhhc2hGdW5jdGlvbixcbiAgICB9KTtcblxuICAgIHRoaXMuc2VyaWFsaXplciA9IHRoaXMub3B0aW9ucy5zZXJpYWxpemVyIHx8IChub29wU2VyaWFsaXplciBhcyBhbnkpO1xuXG4gICAgLy8gU3RvcmUgYSBtYXBwaW5nIGZyb20gaG9zdHBvcnQgLT4gc2VydmVyIHNvIHdlIGNhbiBxdWlja2x5IGdldCBhIHNlcnZlciBvYmplY3QgZnJvbSB0aGUgc2VydmVyS2V5IHJldHVybmVkIGJ5IHRoZSBoYXNoaW5nIGZ1bmN0aW9uXG4gICAgY29uc3Qgc2VydmVyTWFwOiB7IFtob3N0cG9ydDogc3RyaW5nXTogU2VydmVyIH0gPSB7fTtcbiAgICB0aGlzLnNlcnZlcnMuZm9yRWFjaChmdW5jdGlvbiAoc2VydmVyKSB7XG4gICAgICBzZXJ2ZXJNYXBbc2VydmVyLmhvc3Rwb3J0U3RyaW5nKCldID0gc2VydmVyO1xuICAgIH0pO1xuICAgIHRoaXMuc2VydmVyTWFwID0gc2VydmVyTWFwO1xuXG4gICAgLy8gc3RvcmUgYSBsaXN0IG9mIGFsbCBvdXIgc2VydmVyS2V5cyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNvbnN0YW50bHkgcmVhbGxvY2F0ZSB0aGlzIGFycmF5XG4gICAgdGhpcy5zZXJ2ZXJLZXlzID0gT2JqZWN0LmtleXModGhpcy5zZXJ2ZXJNYXApO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgY2xpZW50IGdpdmVuIGFuIG9wdGlvbmFsIGNvbmZpZyBzdHJpbmcgYW5kIG9wdGlvbmFsIGhhc2ggb2ZcbiAgICogb3B0aW9ucy4gVGhlIGNvbmZpZyBzdHJpbmcgc2hvdWxkIGJlIG9mIHRoZSBmb3JtOlxuICAgKlxuICAgKiAgICAgXCJbdXNlcjpwYXNzQF1zZXJ2ZXIxWzoxMTIxMV0sW3VzZXI6cGFzc0Bdc2VydmVyMls6MTEyMTFdLC4uLlwiXG4gICAqXG4gICAqIElmIHRoZSBhcmd1bWVudCBpcyBub3QgZ2l2ZW4sIGZhbGxiYWNrIG9uIHRoZSBgTUVNQ0FDSElFUl9TRVJWRVJTYCBlbnZpcm9ubWVudFxuICAgKiB2YXJpYWJsZSwgYE1FTUNBQ0hFX1NFUlZFUlNgIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGBcImxvY2FsaG9zdDoxMTIxMVwiYC5cbiAgICpcbiAgICogVGhlIG9wdGlvbnMgaGFzaCBtYXkgY29udGFpbiB0aGUgb3B0aW9uczpcbiAgICpcbiAgICogKiBgcmV0cmllc2AgLSB0aGUgbnVtYmVyIG9mIHRpbWVzIHRvIHJldHJ5IGFuIG9wZXJhdGlvbiBpbiBsaWV1IG9mIGZhaWx1cmVzXG4gICAqIChkZWZhdWx0IDIpXG4gICAqICogYGV4cGlyZXNgIC0gdGhlIGRlZmF1bHQgZXhwaXJhdGlvbiBpbiBzZWNvbmRzIHRvIHVzZSAoZGVmYXVsdCAwIC0gbmV2ZXJcbiAgICogZXhwaXJlKS4gSWYgYGV4cGlyZXNgIGlzIGdyZWF0ZXIgdGhhbiAzMCBkYXlzICg2MCB4IDYwIHggMjQgeCAzMCksIGl0IGlzXG4gICAqIHRyZWF0ZWQgYXMgYSBVTklYIHRpbWUgKG51bWJlciBvZiBzZWNvbmRzIHNpbmNlIEphbnVhcnkgMSwgMTk3MCkuXG4gICAqICogYGxvZ2dlcmAgLSBhIGxvZ2dlciBvYmplY3QgdGhhdCByZXNwb25kcyB0byBgbG9nKHN0cmluZylgIG1ldGhvZCBjYWxscy5cbiAgICpcbiAgICogICB+fn5+XG4gICAqICAgICBsb2cobXNnMVssIG1zZzJbLCBtc2czWy4uLl1dXSlcbiAgICogICB+fn5+XG4gICAqXG4gICAqICAgRGVmYXVsdHMgdG8gYGNvbnNvbGVgLlxuICAgKiAqIGBzZXJpYWxpemVyYCAtIHRoZSBvYmplY3Qgd2hpY2ggd2lsbCAoZGUpc2VyaWFsaXplIHRoZSBkYXRhLiBJdCBuZWVkc1xuICAgKiAgIHR3byBwdWJsaWMgbWV0aG9kczogc2VyaWFsaXplIGFuZCBkZXNlcmlhbGl6ZS4gSXQgZGVmYXVsdHMgdG8gdGhlXG4gICAqICAgbm9vcFNlcmlhbGl6ZXI6XG4gICAqXG4gICAqICAgfn5+flxuICAgKiAgIGNvbnN0IG5vb3BTZXJpYWxpemVyID0ge1xuICAgKiAgICAgc2VyaWFsaXplOiBmdW5jdGlvbiAob3Bjb2RlLCB2YWx1ZSwgZXh0cmFzKSB7XG4gICAqICAgICAgIHJldHVybiB7IHZhbHVlOiB2YWx1ZSwgZXh0cmFzOiBleHRyYXMgfTtcbiAgICogICAgIH0sXG4gICAqICAgICBkZXNlcmlhbGl6ZTogZnVuY3Rpb24gKG9wY29kZSwgdmFsdWUsIGV4dHJhcykge1xuICAgKiAgICAgICByZXR1cm4geyB2YWx1ZTogdmFsdWUsIGV4dHJhczogZXh0cmFzIH07XG4gICAqICAgICB9XG4gICAqICAgfTtcbiAgICogICB+fn5+XG4gICAqXG4gICAqIE9yIG9wdGlvbnMgZm9yIHRoZSBzZXJ2ZXJzIGluY2x1ZGluZzpcbiAgICogKiBgdXNlcm5hbWVgIGFuZCBgcGFzc3dvcmRgIGZvciBmYWxsYmFjayBTQVNMIGF1dGhlbnRpY2F0aW9uIGNyZWRlbnRpYWxzLlxuICAgKiAqIGB0aW1lb3V0YCBpbiBzZWNvbmRzIHRvIGRldGVybWluZSBmYWlsdXJlIGZvciBvcGVyYXRpb25zLiBEZWZhdWx0IGlzIDAuNVxuICAgKiAgICAgICAgICAgICBzZWNvbmRzLlxuICAgKiAqICdjb25udGltZW91dCcgaW4gc2Vjb25kcyB0byBjb25uZWN0aW9uIGZhaWx1cmUuIERlZmF1bHQgaXMgdHdpY2UgdGhlIHZhbHVlXG4gICAqICAgICAgICAgICAgICAgICBvZiBgdGltZW91dGAuXG4gICAqICogYGtlZXBBbGl2ZWAgd2hldGhlciB0byBlbmFibGUga2VlcC1hbGl2ZSBmdW5jdGlvbmFsaXR5LiBEZWZhdWx0cyB0byBmYWxzZS5cbiAgICogKiBga2VlcEFsaXZlRGVsYXlgIGluIHNlY29uZHMgdG8gdGhlIGluaXRpYWwgZGVsYXkgYmVmb3JlIHRoZSBmaXJzdCBrZWVwYWxpdmVcbiAgICogICAgICAgICAgICAgICAgICAgIHByb2JlIGlzIHNlbnQgb24gYW4gaWRsZSBzb2NrZXQuIERlZmF1bHRzIGlzIDMwIHNlY29uZHMuXG4gICAqICogYGtleVRvU2VydmVySGFzaEZ1bmN0aW9uYCBhIGZ1bmN0aW9uIHRvIG1hcCBrZXlzIHRvIHNlcnZlcnMsIHdpdGggdGhlIHNpZ25hdHVyZVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoc2VydmVyS2V5czogc3RyaW5nW10sIGtleTogc3RyaW5nKTogc3RyaW5nXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIE5PVEU6IGlmIHlvdSBuZWVkIHRvIGRvIHNvbWUgZXhwZW5zaXZlIGluaXRpYWxpemF0aW9uLCAqcGxlYXNlKiBkbyBpdCBsYXppbHkgdGhlIGZpcnN0IHRpbWUgeW91IHRoaXMgZnVuY3Rpb24gaXMgY2FsbGVkIHdpdGggYW4gYXJyYXkgb2Ygc2VydmVyS2V5cywgbm90IG9uIGV2ZXJ5IGNhbGxcbiAgICovXG4gIHN0YXRpYyBjcmVhdGU8VmFsdWUsIEV4dHJhcz4oXG4gICAgc2VydmVyc1N0cjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIG9wdGlvbnM6IElmQnVmZmVyPFxuICAgICAgVmFsdWUsXG4gICAgICBFeHRyYXMsXG4gICAgICB1bmRlZmluZWQgfCAoUGFydGlhbDxTZXJ2ZXJPcHRpb25zPiAmIEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPiksXG4gICAgICBQYXJ0aWFsPFNlcnZlck9wdGlvbnM+ICYgR2l2ZW5DbGllbnRPcHRpb25zPFZhbHVlLCBFeHRyYXM+XG4gICAgPlxuICApOiBDbGllbnQ8VmFsdWUsIEV4dHJhcz4ge1xuICAgIHNlcnZlcnNTdHIgPVxuICAgICAgc2VydmVyc1N0ciB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSElFUl9TRVJWRVJTIHx8XG4gICAgICBwcm9jZXNzLmVudi5NRU1DQUNIRV9TRVJWRVJTIHx8XG4gICAgICBcImxvY2FsaG9zdDoxMTIxMVwiO1xuICAgIGNvbnN0IHNlcnZlclVyaXMgPSBzZXJ2ZXJzU3RyLnNwbGl0KFwiLFwiKTtcbiAgICBjb25zdCBzZXJ2ZXJzID0gc2VydmVyVXJpcy5tYXAoZnVuY3Rpb24gKHVyaSkge1xuICAgICAgY29uc3QgdXJpUGFydHMgPSB1cmkuc3BsaXQoXCJAXCIpO1xuICAgICAgY29uc3QgaG9zdFBvcnQgPSB1cmlQYXJ0c1t1cmlQYXJ0cy5sZW5ndGggLSAxXS5zcGxpdChcIjpcIik7XG4gICAgICBjb25zdCB1c2VyUGFzcyA9ICh1cmlQYXJ0c1t1cmlQYXJ0cy5sZW5ndGggLSAyXSB8fCBcIlwiKS5zcGxpdChcIjpcIik7XG4gICAgICByZXR1cm4gbmV3IFNlcnZlcihcbiAgICAgICAgaG9zdFBvcnRbMF0sXG4gICAgICAgIHBhcnNlSW50KGhvc3RQb3J0WzFdIHx8IFwiMTEyMTFcIiwgMTApLFxuICAgICAgICB1c2VyUGFzc1swXSxcbiAgICAgICAgdXNlclBhc3NbMV0sXG4gICAgICAgIG9wdGlvbnNcbiAgICAgICk7XG4gICAgfSk7XG4gICAgcmV0dXJuIG5ldyBDbGllbnQoc2VydmVycywgb3B0aW9ucyBhcyBhbnkpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdpdmVuIGEgc2VydmVyS2V5IGZyb21sb29rdXBLZXlUb1NlcnZlcktleSwgcmV0dXJuIHRoZSBjb3JyZXNwb25kaW5nIFNlcnZlciBpbnN0YW5jZVxuICAgKlxuICAgKiBAcGFyYW0gIHtzdHJpbmd9IHNlcnZlcktleVxuICAgKiBAcmV0dXJucyB7U2VydmVyfVxuICAgKi9cbiAgc2VydmVyS2V5VG9TZXJ2ZXIoc2VydmVyS2V5OiBzdHJpbmcpOiBTZXJ2ZXIge1xuICAgIHJldHVybiB0aGlzLnNlcnZlck1hcFtzZXJ2ZXJLZXldO1xuICB9XG5cbiAgLyoqXG4gICAqIEdpdmVuIGEga2V5IHRvIGxvb2sgdXAgaW4gbWVtY2FjaGUsIHJldHVybiBhIHNlcnZlcktleSAoYmFzZWQgb24gc29tZVxuICAgKiBoYXNoaW5nIGZ1bmN0aW9uKSB3aGljaCBjYW4gYmUgdXNlZCB0byBpbmRleCB0aGlzLnNlcnZlck1hcFxuICAgKi9cbiAgbG9va3VwS2V5VG9TZXJ2ZXJLZXkoa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMua2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb24odGhpcy5zZXJ2ZXJLZXlzLCBrZXkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgdmFsdWUgYXQgdGhlIGdpdmVuIGtleSBpbiBtZW1jYWNoZS5cbiAgICovXG4gIGFzeW5jIGdldChrZXk6IHN0cmluZyk6IFByb21pc2U8R2V0UmVzdWx0PFZhbHVlLCBFeHRyYXM+IHwgbnVsbD4ge1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihjb25zdGFudHMuT1BfR0VULCBrZXksIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgY29uc3QgZGVzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLmRlc2VyaWFsaXplKFxuICAgICAgICAgIHJlc3BvbnNlLmhlYWRlci5vcGNvZGUsXG4gICAgICAgICAgcmVzcG9uc2UudmFsLFxuICAgICAgICAgIHJlc3BvbnNlLmV4dHJhc1xuICAgICAgICApO1xuICAgICAgICByZXR1cm4geyAuLi5kZXNlcmlhbGl6ZWQsIGNhczogcmVzcG9uc2UuaGVhZGVyLmNhcyB9O1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJHRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqIEJ1aWxkIGEgcGlwZWxpbmVkIGdldCBtdWx0aSByZXF1ZXN0IGJ5IHNlbmRpbmcgb25lIEdFVEtRIGZvciBlYWNoIGtleSAocXVpZXQsIG1lYW5pbmcgaXQgd29uJ3QgcmVzcG9uZCBpZiB0aGUgdmFsdWUgaXMgbWlzc2luZykgZm9sbG93ZWQgYnkgYSBuby1vcCB0byBmb3JjZSBhIHJlc3BvbnNlIChhbmQgdG8gZ2l2ZSB1cyBhIHNlbnRpbmVsIHJlc3BvbnNlIHRoYXQgdGhlIHBpcGVsaW5lIGlzIGRvbmUpXG4gICAqXG4gICAqIGNmIGh0dHBzOi8vZ2l0aHViLmNvbS9jb3VjaGJhc2UvbWVtY2FjaGVkL2Jsb2IvbWFzdGVyL2RvY3MvQmluYXJ5UHJvdG9jb2wubWQjMHgwZC1nZXRrcS1nZXQtd2l0aC1rZXktcXVpZXRseVxuICAgKi9cbiAgX2J1aWxkR2V0TXVsdGlSZXF1ZXN0KGtleXM6IHN0cmluZ1tdKTogQnVmZmVyIHtcbiAgICAvLyBzdGFydCBhdCAyNCBmb3IgdGhlIG5vLW9wIGNvbW1hbmQgYXQgdGhlIGVuZFxuICAgIGxldCByZXF1ZXN0U2l6ZSA9IDI0O1xuICAgIGZvciAoY29uc3Qga2V5SWR4IGluIGtleXMpIHtcbiAgICAgIHJlcXVlc3RTaXplICs9IEJ1ZmZlci5ieXRlTGVuZ3RoKGtleXNba2V5SWR4XSwgXCJ1dGY4XCIpICsgMjQ7XG4gICAgfVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IEJ1ZmZlci5hbGxvYyhyZXF1ZXN0U2l6ZSk7XG5cbiAgICBsZXQgYnl0ZXNXcml0dGVuID0gMDtcbiAgICBmb3IgKGNvbnN0IGtleUlkeCBpbiBrZXlzKSB7XG4gICAgICBjb25zdCBrZXkgPSBrZXlzW2tleUlkeF07XG4gICAgICBieXRlc1dyaXR0ZW4gKz0gY29weUludG9SZXF1ZXN0QnVmZmVyKFxuICAgICAgICBjb25zdGFudHMuT1BfR0VUS1EsXG4gICAgICAgIGtleSxcbiAgICAgICAgXCJcIixcbiAgICAgICAgXCJcIixcbiAgICAgICAgdGhpcy5zZXEsXG4gICAgICAgIHJlcXVlc3QsXG4gICAgICAgIGJ5dGVzV3JpdHRlblxuICAgICAgKTtcbiAgICB9XG5cbiAgICBieXRlc1dyaXR0ZW4gKz0gY29weUludG9SZXF1ZXN0QnVmZmVyKFxuICAgICAgY29uc3RhbnRzLk9QX05PX09QLFxuICAgICAgXCJcIixcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiLFxuICAgICAgdGhpcy5zZXEsXG4gICAgICByZXF1ZXN0LFxuICAgICAgYnl0ZXNXcml0dGVuXG4gICAgKTtcblxuICAgIHJldHVybiByZXF1ZXN0O1xuICB9XG5cbiAgLyoqIEV4ZWN1dGluZyBhIHBpcGVsaW5lZCAobXVsdGkpIGdldCBhZ2FpbnN0IGEgc2luZ2xlIHNlcnZlci4gVGhpcyBpcyBhIHByaXZhdGUgaW1wbGVtZW50YXRpb24gZGV0YWlsIG9mIGdldE11bHRpLiAqL1xuICBhc3luYyBfZ2V0TXVsdGlUb1NlcnZlcjxLZXlzIGV4dGVuZHMgc3RyaW5nPihcbiAgICBzZXJ2OiBTZXJ2ZXIsXG4gICAga2V5czogS2V5c1tdXG4gICk6IFByb21pc2U8R2V0TXVsdGlSZXN1bHQ8S2V5cywgVmFsdWUsIEV4dHJhcz4+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2VNYXA6IEdldE11bHRpUmVzdWx0PHN0cmluZywgVmFsdWUsIEV4dHJhcz4gPSB7fTtcblxuICAgICAgY29uc3QgaGFuZGxlOiBPblJlc3BvbnNlQ2FsbGJhY2sgPSAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICAgICAgLy8gV2hlbiB3ZSBnZXQgdGhlIG5vLW9wIHJlc3BvbnNlLCB3ZSBhcmUgZG9uZSB3aXRoIHRoaXMgb25lIGdldE11bHRpIGluIHRoZSBwZXItYmFja2VuZCBmYW4tb3V0XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UuaGVhZGVyLm9wY29kZSA9PT0gY29uc3RhbnRzLk9QX05PX09QKSB7XG4gICAgICAgICAgICAgIC8vIFRoaXMgZW5zdXJlcyB0aGUgaGFuZGxlciB3aWxsIGJlIGRlbGV0ZWQgZnJvbSB0aGUgcmVzcG9uc2VDYWxsYmFja3MgbWFwIGluIHNlcnZlci5qc1xuICAgICAgICAgICAgICAvLyBUaGlzIGlzbid0IHRlY2huaWNhbGx5IG5lZWRlZCBoZXJlIGJlY2F1c2UgdGhlIGxvZ2ljIGluIHNlcnZlci5qcyBhbHNvIGNoZWNrcyBpZiB0b3RhbEJvZHlMZW5ndGggPT09IDAsIGJ1dCBvdXIgdW5pdHRlc3RzIGFyZW4ndCBncmVhdCBhYm91dCBzZXR0aW5nIHRoYXQgZmllbGQsIGFuZCBhbHNvIHRoaXMgbWFrZXMgaXQgbW9yZSBleHBsaWNpdFxuICAgICAgICAgICAgICBoYW5kbGUucXVpZXQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgcmVzb2x2ZShyZXNwb25zZU1hcCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb25zdCBkZXNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuZGVzZXJpYWxpemUoXG4gICAgICAgICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLm9wY29kZSxcbiAgICAgICAgICAgICAgICByZXNwb25zZS52YWwsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2UuZXh0cmFzXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIGNvbnN0IGtleSA9IHJlc3BvbnNlLmtleS50b1N0cmluZygpO1xuICAgICAgICAgICAgICByZXNwb25zZU1hcFtrZXldID0geyAuLi5kZXNlcmlhbGl6ZWQsIGNhczogcmVzcG9uc2UuaGVhZGVyLmNhcyB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJHRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cylcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICAvLyBUaGlzIHByZXZlbnRzIHRoZSBoYW5kbGVyIGZyb20gYmVpbmcgZGVsZXRlZFxuICAgICAgLy8gYWZ0ZXIgdGhlIGZpcnN0IHJlc3BvbnNlLiBMb2dpYyBpbiBzZXJ2ZXIuanMuXG4gICAgICBoYW5kbGUucXVpZXQgPSB0cnVlO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gdGhpcy5fYnVpbGRHZXRNdWx0aVJlcXVlc3Qoa2V5cyk7XG4gICAgICBzZXJ2Lm9uUmVzcG9uc2UodGhpcy5zZXEsIGhhbmRsZSk7XG4gICAgICBzZXJ2Lm9uRXJyb3IodGhpcy5zZXEsIHJlamVjdCk7XG4gICAgICB0aGlzLmluY3JTZXEoKTtcbiAgICAgIHNlcnYud3JpdGUocmVxdWVzdCk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldnMgdGhlIHZhbHVlIGF0IHRoZSBnaXZlbiBrZXlzIGluIG1lbWNhY2hlZC4gUmV0dXJucyBhIG1hcCBmcm9tIHRoZVxuICAgKiByZXF1ZXN0ZWQga2V5cyB0byByZXN1bHRzLCBvciBudWxsIGlmIHRoZSBrZXkgd2FzIG5vdCBmb3VuZC5cbiAgICovXG4gIGFzeW5jIGdldE11bHRpPEtleXMgZXh0ZW5kcyBzdHJpbmc+KFxuICAgIGtleXM6IEtleXNbXVxuICApOiBQcm9taXNlPEdldE11bHRpUmVzdWx0PEtleXMsIFZhbHVlLCBFeHRyYXM+PiB7XG4gICAgY29uc3Qgc2VydmVyS2V5dG9Mb29rdXBLZXlzOiB7XG4gICAgICBbc2VydmVyS2V5OiBzdHJpbmddOiBzdHJpbmdbXTtcbiAgICB9ID0ge307XG4gICAga2V5cy5mb3JFYWNoKChsb29rdXBLZXkpID0+IHtcbiAgICAgIGNvbnN0IHNlcnZlcktleSA9IHRoaXMubG9va3VwS2V5VG9TZXJ2ZXJLZXkobG9va3VwS2V5KTtcbiAgICAgIGlmICghc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0pIHtcbiAgICAgICAgc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0gPSBbXTtcbiAgICAgIH1cbiAgICAgIHNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldLnB1c2gobG9va3VwS2V5KTtcbiAgICB9KTtcblxuICAgIGNvbnN0IHVzZWRTZXJ2ZXJLZXlzID0gT2JqZWN0LmtleXMoc2VydmVyS2V5dG9Mb29rdXBLZXlzKTtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICB1c2VkU2VydmVyS2V5cy5tYXAoKHNlcnZlcktleSkgPT4ge1xuICAgICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9nZXRNdWx0aVRvU2VydmVyKHNlcnZlciwgc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0pO1xuICAgICAgfSlcbiAgICApO1xuXG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIC4uLnJlc3VsdHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgYGtleWAgdG8gYHZhbHVlYC5cbiAgICovXG4gIGFzeW5jIHNldChcbiAgICBrZXk6IHN0cmluZyxcbiAgICB2YWx1ZTogVmFsdWUsXG4gICAgb3B0aW9ucz86IHsgZXhwaXJlcz86IG51bWJlcjsgY2FzPzogQ0FTVG9rZW4gfVxuICApOiBQcm9taXNlPGJvb2xlYW4gfCBudWxsPiB7XG4gICAgY29uc3QgZXhwaXJlcyA9IG9wdGlvbnM/LmV4cGlyZXM7XG4gICAgY29uc3QgY2FzID0gb3B0aW9ucz8uY2FzO1xuXG4gICAgLy8gVE9ETzogc3VwcG9ydCBmbGFnc1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBtYWtlRXhwaXJhdGlvbihleHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCBleHRyYXMgPSBCdWZmZXIuY29uY2F0KFtCdWZmZXIuZnJvbShcIjAwMDAwMDAwXCIsIFwiaGV4XCIpLCBleHBpcmF0aW9uXSk7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUoXG4gICAgICBjb25zdGFudHMuT1BfU0VULFxuICAgICAgdmFsdWUsXG4gICAgICBleHRyYXNcbiAgICApO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBVdGlscy5lbmNvZGVSZXF1ZXN0KHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICBvcGNvZGU6IGNvbnN0YW50cy5PUF9TRVQsXG4gICAgICAgIG9wYXF1ZTogdGhpcy5zZXEsXG4gICAgICAgIGNhcyxcbiAgICAgIH0sXG4gICAgICBrZXksXG4gICAgICB2YWx1ZTogc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIGV4dHJhczogc2VyaWFsaXplZC5leHRyYXMsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfRVhJU1RTOlxuICAgICAgICBpZiAoY2FzKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJTRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJTRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFERFxuICAgKlxuICAgKiBBZGRzIHRoZSBnaXZlbiBfa2V5XyBhbmQgX3ZhbHVlXyB0byBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzXG4gICAqIGlmIHRoZSBrZXkgaXMgbm90IGFscmVhZHkgc2V0LlxuICAgKlxuICAgKiBUaGUgb3B0aW9ucyBkaWN0aW9uYXJ5IHRha2VzOlxuICAgKiAqIF9leHBpcmVzXzogb3ZlcnJpZGVzIHRoZSBkZWZhdWx0IGV4cGlyYXRpb24gKHNlZSBgQ2xpZW50LmNyZWF0ZWApIGZvciB0aGlzXG4gICAqICAgICAgICAgICAgICBwYXJ0aWN1bGFyIGtleS12YWx1ZSBwYWlyLlxuICAgKi9cbiAgYXN5bmMgYWRkKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHZhbHVlOiBWYWx1ZSxcbiAgICBvcHRpb25zPzogeyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTxib29sZWFuIHwgbnVsbD4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgZmxhZ3MsIHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBtYWtlRXhwaXJhdGlvbihvcHRpb25zPy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCBleHRyYXMgPSBCdWZmZXIuY29uY2F0KFtCdWZmZXIuZnJvbShcIjAwMDAwMDAwXCIsIFwiaGV4XCIpLCBleHBpcmF0aW9uXSk7XG5cbiAgICBjb25zdCBvcGNvZGUgPSBjb25zdGFudHMuT1BfQUREO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIGV4dHJhcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX0VYSVNUUzpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJBRERcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBnaXZlbiBfa2V5XyBhbmQgX3ZhbHVlXyB0byBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzXG4gICAqIGlmIHRoZSBrZXkgaXMgYWxyZWFkeSBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZShcbiAgICBrZXk6IHN0cmluZyxcbiAgICB2YWx1ZTogVmFsdWUsXG4gICAgb3B0aW9ucz86IHsgZXhwaXJlcz86IG51bWJlciB9XG4gICk6IFByb21pc2U8Ym9vbGVhbiB8IG51bGw+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IGZsYWdzLCBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBleHBpcmF0aW9uID0gbWFrZUV4cGlyYXRpb24ob3B0aW9ucz8uZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcyk7XG4gICAgY29uc3QgZXh0cmFzID0gQnVmZmVyLmNvbmNhdChbQnVmZmVyLmZyb20oXCIwMDAwMDAwMFwiLCBcImhleFwiKSwgZXhwaXJhdGlvbl0pO1xuXG4gICAgY29uc3Qgb3Bjb2RlOiBjb25zdGFudHMuT1AgPSBjb25zdGFudHMuT1BfUkVQTEFDRTtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShvcGNvZGUsIHZhbHVlLCBleHRyYXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJSRVBMQUNFXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRoZSBnaXZlbiBfa2V5XyBmcm9tIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHNcbiAgICogaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBkZWxldGUoa2V5OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBTdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoNCwga2V5LCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG5cbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJERUxFVEVcIiwgcmVzcG9uc2U/LmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbmNyZW1lbnRzIHRoZSBnaXZlbiBfa2V5XyBpbiBtZW1jYWNoZS5cbiAgICovXG4gIGFzeW5jIGluY3JlbWVudChcbiAgICBrZXk6IHN0cmluZyxcbiAgICBhbW91bnQ6IG51bWJlcixcbiAgICBvcHRpb25zPzogeyBpbml0aWFsPzogbnVtYmVyOyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTx7IHZhbHVlOiBudW1iZXIgfCBudWxsOyBzdWNjZXNzOiBib29sZWFuIHwgbnVsbCB9PiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgaW5pdGlhbCA9IG9wdGlvbnM/LmluaXRpYWwgfHwgMDtcbiAgICBjb25zdCBleHBpcmVzID0gb3B0aW9ucz8uZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcztcbiAgICBjb25zdCBleHRyYXMgPSBtYWtlQW1vdW50SW5pdGlhbEFuZEV4cGlyYXRpb24oYW1vdW50LCBpbml0aWFsLCBleHBpcmVzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBjb25zdGFudHMuT1BfSU5DUkVNRU5ULFxuICAgICAga2V5LFxuICAgICAgZXh0cmFzLFxuICAgICAgXCJcIixcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgY29uc3QgYnVmSW50ID1cbiAgICAgICAgICAocmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSgwKSA8PCA4KSArIHJlc3BvbnNlLnZhbC5yZWFkVUludDMyQkUoNCk7XG4gICAgICAgIHJldHVybiB7IHZhbHVlOiBidWZJbnQsIHN1Y2Nlc3M6IHRydWUgfTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJJTkNSRU1FTlRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlY3JlbWVudHMgdGhlIGdpdmVuIGBrZXlgIGluIG1lbWNhY2hlLlxuICAgKi9cbiAgYXN5bmMgZGVjcmVtZW50KFxuICAgIGtleTogc3RyaW5nLFxuICAgIGFtb3VudDogbnVtYmVyLFxuICAgIG9wdGlvbnM6IHsgaW5pdGlhbD86IG51bWJlcjsgZXhwaXJlcz86IG51bWJlciB9XG4gICk6IFByb21pc2U8eyB2YWx1ZTogbnVtYmVyIHwgbnVsbDsgc3VjY2VzczogYm9vbGVhbiB8IG51bGwgfT4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGluaXRpYWwgPSBvcHRpb25zLmluaXRpYWwgfHwgMDtcbiAgICBjb25zdCBleHBpcmVzID0gb3B0aW9ucy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzO1xuICAgIGNvbnN0IGV4dHJhcyA9IG1ha2VBbW91bnRJbml0aWFsQW5kRXhwaXJhdGlvbihhbW91bnQsIGluaXRpYWwsIGV4cGlyZXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIGNvbnN0YW50cy5PUF9ERUNSRU1FTlQsXG4gICAgICBrZXksXG4gICAgICBleHRyYXMsXG4gICAgICBcIlwiLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICBjb25zdCBidWZJbnQgPVxuICAgICAgICAgIChyZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDApIDw8IDgpICsgcmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSg0KTtcbiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJ1ZkludCwgc3VjY2VzczogdHJ1ZSB9O1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkRFQ1JFTUVOVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwZW5kIHRoZSBnaXZlbiBfdmFsdWVfIHRvIHRoZSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGggdGhlIGdpdmVuIF9rZXlfIGluXG4gICAqIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHMgaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBhcHBlbmQoa2V5OiBzdHJpbmcsIHZhbHVlOiBWYWx1ZSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IG9wY29kZTogY29uc3RhbnRzLk9QID0gY29uc3RhbnRzLk9QX0FQUEVORDtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShvcGNvZGUsIHZhbHVlLCBcIlwiKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBvcGNvZGUsXG4gICAgICBrZXksXG4gICAgICBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICAgIHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiQVBQRU5EXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwZW5kIHRoZSBnaXZlbiBfdmFsdWVfIHRvIHRoZSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGggdGhlIGdpdmVuIF9rZXlfIGluXG4gICAqIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHMgaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBwcmVwZW5kKGtleTogc3RyaW5nLCB2YWx1ZTogVmFsdWUpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBvcGNvZGU6IGNvbnN0YW50cy5PUCA9IGNvbnN0YW50cy5PUF9QUkVQRU5EO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIFwiXCIpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJQUkVQRU5EXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUb3VjaCBzZXRzIGFuIGV4cGlyYXRpb24gdmFsdWUsIGdpdmVuIGJ5IF9leHBpcmVzXywgb24gdGhlIGdpdmVuIF9rZXlfIGluXG4gICAqIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHMgaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyB0b3VjaChrZXk6IHN0cmluZywgZXhwaXJlczogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXh0cmFzID0gbWFrZUV4cGlyYXRpb24oZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MWMsIGtleSwgZXh0cmFzLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiVE9VQ0hcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZMVVNIXG4gICAqXG4gICAqIEZsdXNoZXMgdGhlIGNhY2hlIG9uIGVhY2ggY29ubmVjdGVkIHNlcnZlci4gVGhlIGNhbGxiYWNrIHNpZ25hdHVyZSBpczpcbiAgICpcbiAgICogICAgIGNhbGxiYWNrKGxhc3RFcnIsIHJlc3VsdHMpXG4gICAqXG4gICAqIHdoZXJlIF9sYXN0RXJyXyBpcyB0aGUgbGFzdCBlcnJvciBlbmNvdW50ZXJlZCAob3IgbnVsbCwgaW4gdGhlIGNvbW1vbiBjYXNlXG4gICAqIG9mIG5vIGVycm9ycykuIF9yZXN1bHRzXyBpcyBhIGRpY3Rpb25hcnkgbWFwcGluZyBgXCJob3N0bmFtZTpwb3J0XCJgIHRvIGVpdGhlclxuICAgKiBgdHJ1ZWAgKGlmIHRoZSBvcGVyYXRpb24gd2FzIHN1Y2Nlc3NmdWwpLCBvciBhbiBlcnJvci5cbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICBmbHVzaCgpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj4+O1xuICBmbHVzaChcbiAgICBjYWxsYmFjazogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICByZXN1bHRzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+XG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQ7XG4gIGZsdXNoKFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICByZXN1bHRzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+XG4gICAgKSA9PiB2b2lkXG4gICkge1xuICAgIGlmIChjYWxsYmFjayA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5KChjYWxsYmFjaykgPT4ge1xuICAgICAgICB0aGlzLmZsdXNoKGZ1bmN0aW9uIChlcnIsIHJlc3VsdHMpIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnIsIHJlc3VsdHMpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICAvLyBUT0RPOiBzdXBwb3J0IGV4cGlyYXRpb25cbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgwOCwgXCJcIiwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpO1xuICAgIGxldCBjb3VudCA9IHRoaXMuc2VydmVycy5sZW5ndGg7XG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+ID0ge307XG4gICAgbGV0IGxhc3RFcnI6IEVycm9yIHwgbnVsbCA9IG51bGw7XG5cbiAgICBjb25zdCBoYW5kbGVGbHVzaCA9IGZ1bmN0aW9uIChzZXE6IG51bWJlciwgc2VydjogU2VydmVyKSB7XG4gICAgICBzZXJ2Lm9uUmVzcG9uc2Uoc2VxLCBmdW5jdGlvbiAoLyogcmVzcG9uc2UgKi8pIHtcbiAgICAgICAgY291bnQgLT0gMTtcbiAgICAgICAgcmVzdWx0W3NlcnYuaG9zdHBvcnRTdHJpbmcoKV0gPSB0cnVlO1xuICAgICAgICBpZiAoY2FsbGJhY2sgJiYgY291bnQgPT09IDApIHtcbiAgICAgICAgICBjYWxsYmFjayhsYXN0RXJyLCByZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlcnYub25FcnJvcihzZXEsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgY291bnQgLT0gMTtcbiAgICAgICAgbGFzdEVyciA9IGVycjtcbiAgICAgICAgcmVzdWx0W3NlcnYuaG9zdHBvcnRTdHJpbmcoKV0gPSBlcnI7XG4gICAgICAgIGlmIChjYWxsYmFjayAmJiBjb3VudCA9PT0gMCkge1xuICAgICAgICAgIGNhbGxiYWNrKGxhc3RFcnIsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGhhbmRsZUZsdXNoKHRoaXMuc2VxLCB0aGlzLnNlcnZlcnNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTVEFUU19XSVRIX0tFWVxuICAgKlxuICAgKiBTZW5kcyBhIG1lbWNhY2hlIHN0YXRzIGNvbW1hbmQgd2l0aCBhIGtleSB0byBlYWNoIGNvbm5lY3RlZCBzZXJ2ZXIuIFRoZVxuICAgKiBjYWxsYmFjayBpcyBpbnZva2VkICoqT05DRSBQRVIgU0VSVkVSKiogYW5kIGhhcyB0aGUgc2lnbmF0dXJlOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2soZXJyLCBzZXJ2ZXIsIHN0YXRzKVxuICAgKlxuICAgKiBfc2VydmVyXyBpcyB0aGUgYFwiaG9zdG5hbWU6cG9ydFwiYCBvZiB0aGUgc2VydmVyLCBhbmQgX3N0YXRzXyBpcyBhIGRpY3Rpb25hcnlcbiAgICogbWFwcGluZyB0aGUgc3RhdCBuYW1lIHRvIHRoZSB2YWx1ZSBvZiB0aGUgc3RhdGlzdGljIGFzIGEgc3RyaW5nLlxuICAgKiBAcGFyYW0ga2V5XG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgc3RhdHNXaXRoS2V5KFxuICAgIGtleTogc3RyaW5nLFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICBzZXJ2ZXI6IHN0cmluZyxcbiAgICAgIHN0YXRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbFxuICAgICkgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgxMCwga2V5LCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG5cbiAgICBjb25zdCBoYW5kbGVTdGF0cyA9IChzZXE6IG51bWJlciwgc2VydjogU2VydmVyKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgICAgIGNvbnN0IGhhbmRsZTogT25SZXNwb25zZUNhbGxiYWNrID0gKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIC8vIGVuZCBvZiBzdGF0IHJlc3BvbnNlc1xuICAgICAgICBpZiAocmVzcG9uc2UuaGVhZGVyLnRvdGFsQm9keUxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgc2Vydi5ob3N0cG9ydFN0cmluZygpLCByZXN1bHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gcHJvY2VzcyBzaW5nbGUgc3RhdCBsaW5lIHJlc3BvbnNlXG4gICAgICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgICAgIHJlc3VsdFtyZXNwb25zZS5rZXkudG9TdHJpbmcoKV0gPSByZXNwb25zZS52YWwudG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuaGFuZGxlUmVzcG9uc2VFcnJvcihcbiAgICAgICAgICAgICAgYFNUQVRTICgke2tleX0pYCxcbiAgICAgICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCBzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCksIG51bGwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaGFuZGxlLnF1aWV0ID0gdHJ1ZTtcblxuICAgICAgc2Vydi5vblJlc3BvbnNlKHNlcSwgaGFuZGxlKTtcbiAgICAgIHNlcnYub25FcnJvcihzZXEsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyLCBzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCksIG51bGwpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlcnYud3JpdGUocmVxdWVzdCk7XG4gICAgfTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYW5kbGVTdGF0cyh0aGlzLnNlcSwgdGhpcy5zZXJ2ZXJzW2ldKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU1RBVFNcbiAgICpcbiAgICogRmV0Y2hlcyBtZW1jYWNoZSBzdGF0cyBmcm9tIGVhY2ggY29ubmVjdGVkIHNlcnZlci4gVGhlIGNhbGxiYWNrIGlzIGludm9rZWRcbiAgICogKipPTkNFIFBFUiBTRVJWRVIqKiBhbmQgaGFzIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhlcnIsIHNlcnZlciwgc3RhdHMpXG4gICAqXG4gICAqIF9zZXJ2ZXJfIGlzIHRoZSBgXCJob3N0bmFtZTpwb3J0XCJgIG9mIHRoZSBzZXJ2ZXIsIGFuZCBfc3RhdHNfIGlzIGFcbiAgICogZGljdGlvbmFyeSBtYXBwaW5nIHRoZSBzdGF0IG5hbWUgdG8gdGhlIHZhbHVlIG9mIHRoZSBzdGF0aXN0aWMgYXMgYSBzdHJpbmcuXG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgc3RhdHMoXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHNlcnZlcjogc3RyaW5nLFxuICAgICAgc3RhdHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsXG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHNXaXRoS2V5KFwiXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSRVNFVF9TVEFUU1xuICAgKlxuICAgKiBSZXNldCB0aGUgc3RhdGlzdGljcyBlYWNoIHNlcnZlciBpcyBrZWVwaW5nIGJhY2sgdG8gemVyby4gVGhpcyBkb2Vzbid0IGNsZWFyXG4gICAqIHN0YXRzIHN1Y2ggYXMgaXRlbSBjb3VudCwgYnV0IHRlbXBvcmFyeSBzdGF0cyBzdWNoIGFzIHRvdGFsIG51bWJlciBvZlxuICAgKiBjb25uZWN0aW9ucyBvdmVyIHRpbWUuXG4gICAqXG4gICAqIFRoZSBjYWxsYmFjayBpcyBpbnZva2VkICoqT05DRSBQRVIgU0VSVkVSKiogYW5kIGhhcyB0aGUgc2lnbmF0dXJlOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2soZXJyLCBzZXJ2ZXIpXG4gICAqXG4gICAqIF9zZXJ2ZXJfIGlzIHRoZSBgXCJob3N0bmFtZTpwb3J0XCJgIG9mIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgcmVzZXRTdGF0cyhcbiAgICBjYWxsYmFjaz86IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgc2VydmVyOiBzdHJpbmcsXG4gICAgICBzdGF0czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IG51bGxcbiAgICApID0+IHZvaWRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0c1dpdGhLZXkoXCJyZXNldFwiLCBjYWxsYmFjayk7XG4gIH1cblxuICAvKipcbiAgICogUVVJVFxuICAgKlxuICAgKiBDbG9zZXMgdGhlIGNvbm5lY3Rpb24gdG8gZWFjaCBzZXJ2ZXIsIG5vdGlmeWluZyB0aGVtIG9mIHRoaXMgaW50ZW50aW9uLiBOb3RlXG4gICAqIHRoYXQgcXVpdCBjYW4gcmFjZSBhZ2FpbnN0IGFscmVhZHkgb3V0c3RhbmRpbmcgcmVxdWVzdHMgd2hlbiB0aG9zZSByZXF1ZXN0c1xuICAgKiBmYWlsIGFuZCBhcmUgcmV0cmllZCwgbGVhZGluZyB0byB0aGUgcXVpdCBjb21tYW5kIHdpbm5pbmcgYW5kIGNsb3NpbmcgdGhlXG4gICAqIGNvbm5lY3Rpb24gYmVmb3JlIHRoZSByZXRyaWVzIGNvbXBsZXRlLlxuICAgKi9cbiAgcXVpdCgpIHtcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICAvLyBUT0RPOiBOaWNlciBwZXJoYXBzIHRvIGRvIFFVSVRRICgweDE3KSBidXQgbmVlZCBhIG5ldyBjYWxsYmFjayBmb3Igd2hlblxuICAgIC8vIHdyaXRlIGlzIGRvbmUuXG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MDcsIFwiXCIsIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTsgLy8gUVVJVFxuICAgIGxldCBzZXJ2O1xuXG4gICAgY29uc3QgaGFuZGxlUXVpdCA9IGZ1bmN0aW9uIChzZXE6IG51bWJlciwgc2VydjogU2VydmVyKSB7XG4gICAgICBzZXJ2Lm9uUmVzcG9uc2Uoc2VxLCBmdW5jdGlvbiAoLyogcmVzcG9uc2UgKi8pIHtcbiAgICAgICAgc2Vydi5jbG9zZSgpO1xuICAgICAgfSk7XG4gICAgICBzZXJ2Lm9uRXJyb3Ioc2VxLCBmdW5jdGlvbiAoLyogZXJyICovKSB7XG4gICAgICAgIHNlcnYuY2xvc2UoKTtcbiAgICAgIH0pO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHNlcnYgPSB0aGlzLnNlcnZlcnNbaV07XG4gICAgICBoYW5kbGVRdWl0KHRoaXMuc2VxLCBzZXJ2KTtcbiAgICB9XG4gIH1cblxuICBfdmVyc2lvbihzZXJ2ZXI6IFNlcnZlcik6IFByb21pc2U8eyB2YWx1ZTogVmFsdWUgfCBudWxsIH0+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICAgIGNvbnN0YW50cy5PUF9WRVJTSU9OLFxuICAgICAgICBcIlwiLFxuICAgICAgICBcIlwiLFxuICAgICAgICBcIlwiLFxuICAgICAgICB0aGlzLnNlcVxuICAgICAgKTtcbiAgICAgIHRoaXMucGVyZm9ybU9uU2VydmVyKHNlcnZlciwgcmVxdWVzdCwgdGhpcy5zZXEsIChlcnIsIHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cblxuICAgICAgICBzd2l0Y2ggKHJlc3BvbnNlIS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICAgICAgLyogVE9ETzogdGhpcyBpcyBidWdnZWQsIHdlIHNob3VsZCd0IHVzZSB0aGUgZGVzZXJpYWxpemVyIGhlcmUsIHNpbmNlIHZlcnNpb24gYWx3YXlzIHJldHVybnMgYSB2ZXJzaW9uIHN0cmluZy5cbiAgICAgICAgICAgICBUaGUgZGVzZXJpYWxpemVyIHNob3VsZCBvbmx5IGJlIHVzZWQgb24gdXNlciBrZXkgZGF0YS4gKi9cbiAgICAgICAgICAgIGNvbnN0IGRlc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5kZXNlcmlhbGl6ZShcbiAgICAgICAgICAgICAgcmVzcG9uc2UhLmhlYWRlci5vcGNvZGUsXG4gICAgICAgICAgICAgIHJlc3BvbnNlIS52YWwsXG4gICAgICAgICAgICAgIHJlc3BvbnNlIS5leHRyYXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXR1cm4gcmVzb2x2ZSh7IHZhbHVlOiBkZXNlcmlhbGl6ZWQudmFsdWUgfSk7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJWRVJTSU9OXCIsIHJlc3BvbnNlIS5oZWFkZXIuc3RhdHVzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVxdWVzdCB0aGUgc2VydmVyIHZlcnNpb24gZnJvbSB0aGUgXCJmaXJzdFwiIHNlcnZlciBpbiB0aGUgYmFja2VuZCBwb29sLlxuICAgKiBUaGUgc2VydmVyIHJlc3BvbmRzIHdpdGggYSBwYWNrZXQgY29udGFpbmluZyB0aGUgdmVyc2lvbiBzdHJpbmcgaW4gdGhlIGJvZHkgd2l0aCB0aGUgZm9sbG93aW5nIGZvcm1hdDogXCJ4LnkuelwiXG4gICAqL1xuICB2ZXJzaW9uKCk6IFByb21pc2U8eyB2YWx1ZTogVmFsdWUgfCBudWxsIH0+IHtcbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHRoaXMuc2VydmVyS2V5c1swXSk7XG4gICAgcmV0dXJuIHRoaXMuX3ZlcnNpb24oc2VydmVyKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIHNlcnZlciB2ZXJzaW9uIGZyb20gYWxsIHRoZSBzZXJ2ZXJzXG4gICAqIGluIHRoZSBiYWNrZW5kIHBvb2wsIGVycm9ycyBpZiBhbnkgb25lIG9mIHRoZW0gaGFzIGFuXG4gICAqIGVycm9yXG4gICAqL1xuICBhc3luYyB2ZXJzaW9uQWxsKCk6IFByb21pc2U8e1xuICAgIHZhbHVlczogUmVjb3JkPHN0cmluZywgVmFsdWUgfCBudWxsPjtcbiAgfT4ge1xuICAgIGNvbnN0IHZlcnNpb25PYmplY3RzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICB0aGlzLnNlcnZlcktleXMubWFwKChzZXJ2ZXJLZXkpID0+IHtcbiAgICAgICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXkpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLl92ZXJzaW9uKHNlcnZlcikudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICByZXR1cm4geyBzZXJ2ZXJLZXk6IHNlcnZlcktleSwgdmFsdWU6IHJlc3BvbnNlLnZhbHVlIH07XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICApO1xuICAgIGNvbnN0IHZhbHVlcyA9IHZlcnNpb25PYmplY3RzLnJlZHVjZSgoYWNjdW11bGF0b3IsIHZlcnNpb25PYmplY3QpID0+IHtcbiAgICAgIGFjY3VtdWxhdG9yW3ZlcnNpb25PYmplY3Quc2VydmVyS2V5XSA9IHZlcnNpb25PYmplY3QudmFsdWU7XG4gICAgICByZXR1cm4gYWNjdW11bGF0b3I7XG4gICAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgVmFsdWUgfCBudWxsPik7XG4gICAgcmV0dXJuIHsgdmFsdWVzOiB2YWx1ZXMgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgKGFicnVwdGx5KSBjb25uZWN0aW9ucyB0byBhbGwgdGhlIHNlcnZlcnMuXG4gICAqIEBzZWUgdGhpcy5xdWl0XG4gICAqL1xuICBjbG9zZSgpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgdGhpcy5zZXJ2ZXJzW2ldLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gYSBnZW5lcmljIHNpbmdsZSByZXNwb25zZSBvcGVyYXRpb24gKGdldCwgc2V0IGV0Yykgb24gb25lIHNlcnZlclxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IHRoZSBrZXkgdG8gaGFzaCB0byBnZXQgYSBzZXJ2ZXIgZnJvbSB0aGUgcG9vbFxuICAgKiBAcGFyYW0ge2J1ZmZlcn0gcmVxdWVzdCBhIGJ1ZmZlciBjb250YWluaW5nIHRoZSByZXF1ZXN0XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZXEgdGhlIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgb3BlcmF0aW9uLiBJdCBpcyB1c2VkIHRvIHBpbiB0aGUgY2FsbGJhY2tzXG4gICAgICAgICAgICAgICAgICAgICAgICAgdG8gYSBzcGVjaWZpYyBvcGVyYXRpb24gYW5kIHNob3VsZCBuZXZlciBjaGFuZ2UgZHVyaW5nIGEgYHBlcmZvcm1gLlxuICAgKiBAcGFyYW0ge251bWJlcj99IHJldHJpZXMgbnVtYmVyIG9mIHRpbWVzIHRvIHJldHJ5IHJlcXVlc3Qgb24gZmFpbHVyZVxuICAgKi9cbiAgcGVyZm9ybShcbiAgICBrZXk6IHN0cmluZyxcbiAgICByZXF1ZXN0OiBCdWZmZXIsXG4gICAgc2VxOiBudW1iZXIsXG4gICAgcmV0cmllcz86IG51bWJlclxuICApOiBQcm9taXNlPE1lc3NhZ2U+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgc2VydmVyS2V5ID0gdGhpcy5sb29rdXBLZXlUb1NlcnZlcktleShrZXkpO1xuICAgICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXkpO1xuXG4gICAgICBpZiAoIXNlcnZlcikge1xuICAgICAgICByZXR1cm4gcmVqZWN0KG5ldyBFcnJvcihcIk5vIHNlcnZlcnMgYXZhaWxhYmxlXCIpKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5wZXJmb3JtT25TZXJ2ZXIoXG4gICAgICAgIHNlcnZlcixcbiAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgc2VxLFxuICAgICAgICAoZXJyb3IsIHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVzb2x2ZShyZXNwb25zZSEpO1xuICAgICAgICB9LFxuICAgICAgICByZXRyaWVzXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcGVyZm9ybU9uU2VydmVyKFxuICAgIHNlcnZlcjogU2VydmVyLFxuICAgIHJlcXVlc3Q6IEJ1ZmZlcixcbiAgICBzZXE6IG51bWJlcixcbiAgICBjYWxsYmFjazogUmVzcG9uc2VPckVycm9yQ2FsbGJhY2ssXG4gICAgcmV0cmllczogbnVtYmVyID0gMFxuICApIHtcbiAgICBjb25zdCBfdGhpcyA9IHRoaXM7XG5cbiAgICByZXRyaWVzID0gcmV0cmllcyB8fCB0aGlzLm9wdGlvbnMucmV0cmllcztcbiAgICBjb25zdCBvcmlnUmV0cmllcyA9IHRoaXMub3B0aW9ucy5yZXRyaWVzO1xuICAgIGNvbnN0IGxvZ2dlciA9IHRoaXMub3B0aW9ucy5sb2dnZXI7XG4gICAgY29uc3QgcmV0cnlfZGVsYXkgPSB0aGlzLm9wdGlvbnMucmV0cnlfZGVsYXk7XG5cbiAgICBjb25zdCByZXNwb25zZUhhbmRsZXI6IE9uUmVzcG9uc2VDYWxsYmFjayA9IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgY29uc3QgZXJyb3JIYW5kbGVyOiBPbkVycm9yQ2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgIGlmICgtLXJldHJpZXMgPiAwKSB7XG4gICAgICAgIC8vIFdhaXQgZm9yIHJldHJ5X2RlbGF5XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIF90aGlzLnBlcmZvcm1PblNlcnZlcihzZXJ2ZXIsIHJlcXVlc3QsIHNlcSwgY2FsbGJhY2ssIHJldHJpZXMpO1xuICAgICAgICB9LCAxMDAwICogcmV0cnlfZGVsYXkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmxvZyhcbiAgICAgICAgICBcIk1lbUpTOiBTZXJ2ZXIgPFwiICtcbiAgICAgICAgICAgIHNlcnZlci5ob3N0cG9ydFN0cmluZygpICtcbiAgICAgICAgICAgIFwiPiBmYWlsZWQgYWZ0ZXIgKFwiICtcbiAgICAgICAgICAgIG9yaWdSZXRyaWVzICtcbiAgICAgICAgICAgIFwiKSByZXRyaWVzIHdpdGggZXJyb3IgLSBcIiArXG4gICAgICAgICAgICBlcnJvci5tZXNzYWdlXG4gICAgICAgICk7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICBzZXJ2ZXIub25SZXNwb25zZShzZXEsIHJlc3BvbnNlSGFuZGxlcik7XG4gICAgc2VydmVyLm9uRXJyb3Ioc2VxLCBlcnJvckhhbmRsZXIpO1xuICAgIHNlcnZlci53cml0ZShyZXF1ZXN0KTtcbiAgfVxuXG4gIC8vIEluY3JlbWVudCB0aGUgc2VxIHZhbHVlXG4gIGluY3JTZXEoKSB7XG4gICAgdGhpcy5zZXErKztcblxuICAgIC8vIFdyYXAgYHRoaXMuc2VxYCB0byAzMi1iaXRzIHNpbmNlIHRoZSBmaWVsZCB3ZSBmaXQgaXQgaW50byBpcyBvbmx5IDMyLWJpdHMuXG4gICAgdGhpcy5zZXEgJj0gMHhmZmZmZmZmZjtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQW5kTG9nRXJyb3IoXG4gICAgY29tbWFuZE5hbWU6IHN0cmluZyxcbiAgICByZXNwb25zZVN0YXR1czogUmVzcG9uc2VTdGF0dXMgfCB1bmRlZmluZWRcbiAgKTogRXJyb3Ige1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBNZW1KUyAke2NvbW1hbmROYW1lfTogJHtjb25zdGFudHMucmVzcG9uc2VTdGF0dXNUb1N0cmluZyhcbiAgICAgIHJlc3BvbnNlU3RhdHVzXG4gICAgKX1gO1xuICAgIHRoaXMub3B0aW9ucy5sb2dnZXIubG9nKGVycm9yTWVzc2FnZSk7XG4gICAgcmV0dXJuIG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhbiBlcnJvciB0byB0aGUgbG9nZ2VyLCB0aGVuIHJldHVybiB0aGUgZXJyb3IuXG4gICAqIElmIGEgY2FsbGJhY2sgaXMgZ2l2ZW4sIGNhbGwgaXQgd2l0aCBjYWxsYmFjayhlcnJvciwgbnVsbCkuXG4gICAqL1xuICBwcml2YXRlIGhhbmRsZVJlc3BvbnNlRXJyb3IoXG4gICAgY29tbWFuZE5hbWU6IHN0cmluZyxcbiAgICByZXNwb25zZVN0YXR1czogUmVzcG9uc2VTdGF0dXMgfCB1bmRlZmluZWQsXG4gICAgY2FsbGJhY2s6IHVuZGVmaW5lZCB8ICgoZXJyb3I6IEVycm9yIHwgbnVsbCwgb3RoZXI6IG51bGwpID0+IHZvaWQpXG4gICk6IEVycm9yIHtcbiAgICBjb25zdCBlcnJvciA9IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoY29tbWFuZE5hbWUsIHJlc3BvbnNlU3RhdHVzKTtcbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcbiAgICB9XG4gICAgcmV0dXJuIGVycm9yO1xuICB9XG59XG5cbmV4cG9ydCB7IENsaWVudCwgU2VydmVyLCBVdGlscywgSGVhZGVyIH07XG4iXX0=