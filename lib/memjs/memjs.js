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
    _buildGetMultiRequest(keys, seq) {
        // start at 24 for the no-op command at the end
        let requestSize = 24;
        for (const keyIdx in keys) {
            requestSize += Buffer.byteLength(keys[keyIdx], "utf8") + 24;
        }
        const request = Buffer.alloc(requestSize);
        let bytesWritten = 0;
        for (const keyIdx in keys) {
            const key = keys[keyIdx];
            bytesWritten += utils_1.copyIntoRequestBuffer(constants.OP_GETKQ, key, "", "", seq, request, bytesWritten);
        }
        bytesWritten += utils_1.copyIntoRequestBuffer(constants.OP_NO_OP, "", "", "", seq, request, bytesWritten);
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
                        else if (response.header.opcode === constants.OP_GETK || response.header.opcode === constants.OP_GETKQ) {
                            const deserialized = this.serializer.deserialize(response.header.opcode, response.val, response.extras);
                            const key = response.key.toString();
                            if (key.length === 0) {
                                return reject(new Error("Recieved empty key in getMulti: " + JSON.stringify(response)));
                            }
                            responseMap[key] = { ...deserialized, cas: response.header.cas };
                        }
                        else {
                            return reject(new Error("Recieved response in getMulti for unknown opcode: " + JSON.stringify(response)));
                        }
                        break;
                    default:
                        return reject(this.createAndLogError("GET", response.header.status));
                }
            };
            // This prevents the handler from being deleted
            // after the first response. Logic in server.js.
            handle.quiet = true;
            const seq = this.incrSeq();
            const request = this._buildGetMultiRequest(keys, seq);
            serv.onResponse(this.seq, handle);
            serv.onError(this.seq, reject);
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
        return this.seq;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVtanMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvbWVtanMvbWVtanMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLHdCQUF3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUV4QixxQ0FLa0I7QUEraENELHVGQWppQ2YsZUFBTSxPQWlpQ2U7QUE5aEN2Qix1REFBK0Q7QUFDL0QsbUNBU2lCO0FBQ2pCLHVEQUF5QztBQUN6QywyQ0FBNkM7QUFDN0MsK0NBQWlDO0FBaWhDUixzQkFBSztBQWhoQzlCLGlEQUFtQztBQWdoQ0gsd0JBQU07QUE5Z0N0QyxTQUFTLDhCQUE4QixDQUNyQyxPQUFpQixFQUNqQixHQUFXO0lBRVgsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUM3QixNQUFNLEtBQUssR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hCLENBQUM7QUFFRCwrQ0FBK0M7QUFDL0MsU0FBUyxTQUFTLENBQ2hCLE9BQTBFO0lBRTFFLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxPQUFPLEVBQUUsTUFBTTtRQUMxQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUUsTUFBTTtZQUMzQixHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBNkRELE1BQU0sTUFBTTtJQVFWLDRFQUE0RTtJQUM1RSxtQ0FBbUM7SUFDbkMsWUFBWSxPQUFpQixFQUFFLE9BQTBDO1FBQ3ZFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElB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LFlBQVksQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7O09BR0c7SUFDSyxtQkFBbUIsQ0FDekIsV0FBbUIsRUFDbkIsY0FBMEMsRUFDMUMsUUFBa0U7UUFFbEUsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxjQUFjLENBQUMsQ0FBQztRQUNsRSxJQUFJLFFBQVEsRUFBRTtZQUNaLFFBQVEsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUM7U0FDdkI7UUFDRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7Q0FDRjtBQUVRLHdCQUFNIiwic291cmNlc0NvbnRlbnQiOlsiLy8gTWVtVFMgTWVtY2FjaGUgQ2xpZW50XG5cbmltcG9ydCB7XG4gIE9uRXJyb3JDYWxsYmFjayxcbiAgT25SZXNwb25zZUNhbGxiYWNrLFxuICBTZXJ2ZXIsXG4gIFNlcnZlck9wdGlvbnMsXG59IGZyb20gXCIuL3NlcnZlclwiO1xuaW1wb3J0IHsgbm9vcFNlcmlhbGl6ZXIsIFNlcmlhbGl6ZXIgfSBmcm9tIFwiLi9ub29wLXNlcmlhbGl6ZXJcIjtcbmltcG9ydCB7XG4gIG1ha2VSZXF1ZXN0QnVmZmVyLFxuICBjb3B5SW50b1JlcXVlc3RCdWZmZXIsXG4gIG1lcmdlLFxuICBtYWtlRXhwaXJhdGlvbixcbiAgbWFrZUFtb3VudEluaXRpYWxBbmRFeHBpcmF0aW9uLFxuICBoYXNoQ29kZSxcbiAgTWF5YmVCdWZmZXIsXG4gIE1lc3NhZ2UsXG59IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgKiBhcyBjb25zdGFudHMgZnJvbSBcIi4vY29uc3RhbnRzXCI7XG5pbXBvcnQgeyBSZXNwb25zZVN0YXR1cyB9IGZyb20gXCIuL2NvbnN0YW50c1wiO1xuaW1wb3J0ICogYXMgVXRpbHMgZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCAqIGFzIEhlYWRlciBmcm9tIFwiLi9oZWFkZXJcIjtcblxuZnVuY3Rpb24gZGVmYXVsdEtleVRvU2VydmVySGFzaEZ1bmN0aW9uKFxuICBzZXJ2ZXJzOiBzdHJpbmdbXSxcbiAga2V5OiBzdHJpbmdcbik6IHN0cmluZyB7XG4gIGNvbnN0IHRvdGFsID0gc2VydmVycy5sZW5ndGg7XG4gIGNvbnN0IGluZGV4ID0gdG90YWwgPiAxID8gaGFzaENvZGUoa2V5KSAlIHRvdGFsIDogMDtcbiAgcmV0dXJuIHNlcnZlcnNbaW5kZXhdO1xufVxuXG4vLyBjb252ZXJ0cyBhIGNhbGwgaW50byBhIHByb21pc2UtcmV0dXJuaW5nIG9uZVxuZnVuY3Rpb24gcHJvbWlzaWZ5PFJlc3VsdD4oXG4gIGNvbW1hbmQ6IChjYWxsYmFjazogKGVycm9yOiBFcnJvciB8IG51bGwsIHJlc3VsdDogUmVzdWx0KSA9PiB2b2lkKSA9PiB2b2lkXG4pOiBQcm9taXNlPFJlc3VsdD4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgIGNvbW1hbmQoZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUocmVzdWx0KTtcbiAgICB9KTtcbiAgfSk7XG59XG5cbnR5cGUgUmVzcG9uc2VPckVycm9yQ2FsbGJhY2sgPSAoXG4gIGVycm9yOiBFcnJvciB8IG51bGwsXG4gIHJlc3BvbnNlOiBNZXNzYWdlIHwgbnVsbFxuKSA9PiB2b2lkO1xuXG5pbnRlcmZhY2UgQmFzZUNsaWVudE9wdGlvbnMge1xuICByZXRyaWVzOiBudW1iZXI7XG4gIHJldHJ5X2RlbGF5OiBudW1iZXI7XG4gIGV4cGlyZXM6IG51bWJlcjtcbiAgbG9nZ2VyOiB7IGxvZzogdHlwZW9mIGNvbnNvbGUubG9nIH07XG4gIGtleVRvU2VydmVySGFzaEZ1bmN0aW9uOiB0eXBlb2YgZGVmYXVsdEtleVRvU2VydmVySGFzaEZ1bmN0aW9uO1xufVxuXG5pbnRlcmZhY2UgU2VyaWFsaXplclByb3A8VmFsdWUsIEV4dHJhcz4ge1xuICBzZXJpYWxpemVyOiBTZXJpYWxpemVyPFZhbHVlLCBFeHRyYXM+O1xufVxuXG4vKipcbiAqIFRoZSBjbGllbnQgaGFzIHBhcnRpYWwgc3VwcG9ydCBmb3Igc2VyaWFsaXppbmcgYW5kIGRlc2VyaWFsaXppbmcgdmFsdWVzIGZyb20gdGhlXG4gKiBCdWZmZXIgYnl0ZSBzdHJpbmdzIHdlIHJlY2lldmUgZnJvbSB0aGUgd2lyZS4gVGhlIGRlZmF1bHQgc2VyaWFsaXplciBpcyBmb3IgTWF5YmVCdWZmZXIuXG4gKlxuICogSWYgVmFsdWUgYW5kIEV4dHJhcyBhcmUgb2YgdHlwZSBCdWZmZXIsIHRoZW4gcmV0dXJuIHR5cGUgV2hlbkJ1ZmZlci4gT3RoZXJ3aXNlLFxuICogcmV0dXJuIHR5cGUgTm90QnVmZmVyLlxuICovXG50eXBlIElmQnVmZmVyPFxuICBWYWx1ZSxcbiAgRXh0cmFzLFxuICBXaGVuVmFsdWVBbmRFeHRyYXNBcmVCdWZmZXJzLFxuICBOb3RCdWZmZXJcbj4gPSBWYWx1ZSBleHRlbmRzIEJ1ZmZlclxuICA/IEV4dHJhcyBleHRlbmRzIEJ1ZmZlclxuICAgID8gV2hlblZhbHVlQW5kRXh0cmFzQXJlQnVmZmVyc1xuICAgIDogTm90QnVmZmVyXG4gIDogTm90QnVmZmVyO1xuXG5leHBvcnQgdHlwZSBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz4gPSBQYXJ0aWFsPEJhc2VDbGllbnRPcHRpb25zPiAmXG4gIElmQnVmZmVyPFxuICAgIFZhbHVlLFxuICAgIEV4dHJhcyxcbiAgICBQYXJ0aWFsPFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+PixcbiAgICBTZXJpYWxpemVyUHJvcDxWYWx1ZSwgRXh0cmFzPlxuICA+O1xuXG5leHBvcnQgdHlwZSBDQVNUb2tlbiA9IEJ1ZmZlcjtcblxuZXhwb3J0IGludGVyZmFjZSBHZXRSZXN1bHQ8VmFsdWUgPSBNYXliZUJ1ZmZlciwgRXh0cmFzID0gTWF5YmVCdWZmZXI+IHtcbiAgdmFsdWU6IFZhbHVlO1xuICBleHRyYXM6IEV4dHJhcztcbiAgY2FzOiBDQVNUb2tlbiB8IHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IHR5cGUgR2V0TXVsdGlSZXN1bHQ8XG4gIEtleXMgZXh0ZW5kcyBzdHJpbmcgPSBzdHJpbmcsXG4gIFZhbHVlID0gTWF5YmVCdWZmZXIsXG4gIEV4dHJhcyA9IE1heWJlQnVmZmVyXG4+ID0ge1xuICBbSyBpbiBLZXlzXT86IEdldFJlc3VsdDxWYWx1ZSwgRXh0cmFzPjtcbn07XG5cbmNsYXNzIENsaWVudDxWYWx1ZSA9IE1heWJlQnVmZmVyLCBFeHRyYXMgPSBNYXliZUJ1ZmZlcj4ge1xuICBzZXJ2ZXJzOiBTZXJ2ZXJbXTtcbiAgc2VxOiBudW1iZXI7XG4gIG9wdGlvbnM6IEJhc2VDbGllbnRPcHRpb25zICYgUGFydGlhbDxTZXJpYWxpemVyUHJvcDxWYWx1ZSwgRXh0cmFzPj47XG4gIHNlcmlhbGl6ZXI6IFNlcmlhbGl6ZXI8VmFsdWUsIEV4dHJhcz47XG4gIHNlcnZlck1hcDogeyBbaG9zdHBvcnQ6IHN0cmluZ106IFNlcnZlciB9O1xuICBzZXJ2ZXJLZXlzOiBzdHJpbmdbXTtcblxuICAvLyBDbGllbnQgaW5pdGlhbGl6ZXIgdGFrZXMgYSBsaXN0IG9mIGBTZXJ2ZXJgcyBhbmQgYW4gYG9wdGlvbnNgIGRpY3Rpb25hcnkuXG4gIC8vIFNlZSBgQ2xpZW50LmNyZWF0ZWAgZm9yIGRldGFpbHMuXG4gIGNvbnN0cnVjdG9yKHNlcnZlcnM6IFNlcnZlcltdLCBvcHRpb25zOiBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz4pIHtcbiAgICB0aGlzLnNlcnZlcnMgPSBzZXJ2ZXJzO1xuICAgIHRoaXMuc2VxID0gMDtcbiAgICB0aGlzLm9wdGlvbnMgPSBtZXJnZShvcHRpb25zIHx8IHt9LCB7XG4gICAgICByZXRyaWVzOiAyLFxuICAgICAgcmV0cnlfZGVsYXk6IDAuMixcbiAgICAgIGV4cGlyZXM6IDAsXG4gICAgICBsb2dnZXI6IGNvbnNvbGUsXG4gICAgICBrZXlUb1NlcnZlckhhc2hGdW5jdGlvbjogZGVmYXVsdEtleVRvU2VydmVySGFzaEZ1bmN0aW9uLFxuICAgIH0pO1xuXG4gICAgdGhpcy5zZXJpYWxpemVyID0gdGhpcy5vcHRpb25zLnNlcmlhbGl6ZXIgfHwgKG5vb3BTZXJpYWxpemVyIGFzIGFueSk7XG5cbiAgICAvLyBTdG9yZSBhIG1hcHBpbmcgZnJvbSBob3N0cG9ydCAtPiBzZXJ2ZXIgc28gd2UgY2FuIHF1aWNrbHkgZ2V0IGEgc2VydmVyIG9iamVjdCBmcm9tIHRoZSBzZXJ2ZXJLZXkgcmV0dXJuZWQgYnkgdGhlIGhhc2hpbmcgZnVuY3Rpb25cbiAgICBjb25zdCBzZXJ2ZXJNYXA6IHsgW2hvc3Rwb3J0OiBzdHJpbmddOiBTZXJ2ZXIgfSA9IHt9O1xuICAgIHRoaXMuc2VydmVycy5mb3JFYWNoKGZ1bmN0aW9uIChzZXJ2ZXIpIHtcbiAgICAgIHNlcnZlck1hcFtzZXJ2ZXIuaG9zdHBvcnRTdHJpbmcoKV0gPSBzZXJ2ZXI7XG4gICAgfSk7XG4gICAgdGhpcy5zZXJ2ZXJNYXAgPSBzZXJ2ZXJNYXA7XG5cbiAgICAvLyBzdG9yZSBhIGxpc3Qgb2YgYWxsIG91ciBzZXJ2ZXJLZXlzIHNvIHdlIGRvbid0IG5lZWQgdG8gY29uc3RhbnRseSByZWFsbG9jYXRlIHRoaXMgYXJyYXlcbiAgICB0aGlzLnNlcnZlcktleXMgPSBPYmplY3Qua2V5cyh0aGlzLnNlcnZlck1hcCk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBjbGllbnQgZ2l2ZW4gYW4gb3B0aW9uYWwgY29uZmlnIHN0cmluZyBhbmQgb3B0aW9uYWwgaGFzaCBvZlxuICAgKiBvcHRpb25zLiBUaGUgY29uZmlnIHN0cmluZyBzaG91bGQgYmUgb2YgdGhlIGZvcm06XG4gICAqXG4gICAqICAgICBcIlt1c2VyOnBhc3NAXXNlcnZlcjFbOjExMjExXSxbdXNlcjpwYXNzQF1zZXJ2ZXIyWzoxMTIxMV0sLi4uXCJcbiAgICpcbiAgICogSWYgdGhlIGFyZ3VtZW50IGlzIG5vdCBnaXZlbiwgZmFsbGJhY2sgb24gdGhlIGBNRU1DQUNISUVSX1NFUlZFUlNgIGVudmlyb25tZW50XG4gICAqIHZhcmlhYmxlLCBgTUVNQ0FDSEVfU0VSVkVSU2AgZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgYFwibG9jYWxob3N0OjExMjExXCJgLlxuICAgKlxuICAgKiBUaGUgb3B0aW9ucyBoYXNoIG1heSBjb250YWluIHRoZSBvcHRpb25zOlxuICAgKlxuICAgKiAqIGByZXRyaWVzYCAtIHRoZSBudW1iZXIgb2YgdGltZXMgdG8gcmV0cnkgYW4gb3BlcmF0aW9uIGluIGxpZXUgb2YgZmFpbHVyZXNcbiAgICogKGRlZmF1bHQgMilcbiAgICogKiBgZXhwaXJlc2AgLSB0aGUgZGVmYXVsdCBleHBpcmF0aW9uIGluIHNlY29uZHMgdG8gdXNlIChkZWZhdWx0IDAgLSBuZXZlclxuICAgKiBleHBpcmUpLiBJZiBgZXhwaXJlc2AgaXMgZ3JlYXRlciB0aGFuIDMwIGRheXMgKDYwIHggNjAgeCAyNCB4IDMwKSwgaXQgaXNcbiAgICogdHJlYXRlZCBhcyBhIFVOSVggdGltZSAobnVtYmVyIG9mIHNlY29uZHMgc2luY2UgSmFudWFyeSAxLCAxOTcwKS5cbiAgICogKiBgbG9nZ2VyYCAtIGEgbG9nZ2VyIG9iamVjdCB0aGF0IHJlc3BvbmRzIHRvIGBsb2coc3RyaW5nKWAgbWV0aG9kIGNhbGxzLlxuICAgKlxuICAgKiAgIH5+fn5cbiAgICogICAgIGxvZyhtc2cxWywgbXNnMlssIG1zZzNbLi4uXV1dKVxuICAgKiAgIH5+fn5cbiAgICpcbiAgICogICBEZWZhdWx0cyB0byBgY29uc29sZWAuXG4gICAqICogYHNlcmlhbGl6ZXJgIC0gdGhlIG9iamVjdCB3aGljaCB3aWxsIChkZSlzZXJpYWxpemUgdGhlIGRhdGEuIEl0IG5lZWRzXG4gICAqICAgdHdvIHB1YmxpYyBtZXRob2RzOiBzZXJpYWxpemUgYW5kIGRlc2VyaWFsaXplLiBJdCBkZWZhdWx0cyB0byB0aGVcbiAgICogICBub29wU2VyaWFsaXplcjpcbiAgICpcbiAgICogICB+fn5+XG4gICAqICAgY29uc3Qgbm9vcFNlcmlhbGl6ZXIgPSB7XG4gICAqICAgICBzZXJpYWxpemU6IGZ1bmN0aW9uIChvcGNvZGUsIHZhbHVlLCBleHRyYXMpIHtcbiAgICogICAgICAgcmV0dXJuIHsgdmFsdWU6IHZhbHVlLCBleHRyYXM6IGV4dHJhcyB9O1xuICAgKiAgICAgfSxcbiAgICogICAgIGRlc2VyaWFsaXplOiBmdW5jdGlvbiAob3Bjb2RlLCB2YWx1ZSwgZXh0cmFzKSB7XG4gICAqICAgICAgIHJldHVybiB7IHZhbHVlOiB2YWx1ZSwgZXh0cmFzOiBleHRyYXMgfTtcbiAgICogICAgIH1cbiAgICogICB9O1xuICAgKiAgIH5+fn5cbiAgICpcbiAgICogT3Igb3B0aW9ucyBmb3IgdGhlIHNlcnZlcnMgaW5jbHVkaW5nOlxuICAgKiAqIGB1c2VybmFtZWAgYW5kIGBwYXNzd29yZGAgZm9yIGZhbGxiYWNrIFNBU0wgYXV0aGVudGljYXRpb24gY3JlZGVudGlhbHMuXG4gICAqICogYHRpbWVvdXRgIGluIHNlY29uZHMgdG8gZGV0ZXJtaW5lIGZhaWx1cmUgZm9yIG9wZXJhdGlvbnMuIERlZmF1bHQgaXMgMC41XG4gICAqICAgICAgICAgICAgIHNlY29uZHMuXG4gICAqICogJ2Nvbm50aW1lb3V0JyBpbiBzZWNvbmRzIHRvIGNvbm5lY3Rpb24gZmFpbHVyZS4gRGVmYXVsdCBpcyB0d2ljZSB0aGUgdmFsdWVcbiAgICogICAgICAgICAgICAgICAgIG9mIGB0aW1lb3V0YC5cbiAgICogKiBga2VlcEFsaXZlYCB3aGV0aGVyIHRvIGVuYWJsZSBrZWVwLWFsaXZlIGZ1bmN0aW9uYWxpdHkuIERlZmF1bHRzIHRvIGZhbHNlLlxuICAgKiAqIGBrZWVwQWxpdmVEZWxheWAgaW4gc2Vjb25kcyB0byB0aGUgaW5pdGlhbCBkZWxheSBiZWZvcmUgdGhlIGZpcnN0IGtlZXBhbGl2ZVxuICAgKiAgICAgICAgICAgICAgICAgICAgcHJvYmUgaXMgc2VudCBvbiBhbiBpZGxlIHNvY2tldC4gRGVmYXVsdHMgaXMgMzAgc2Vjb25kcy5cbiAgICogKiBga2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb25gIGEgZnVuY3Rpb24gdG8gbWFwIGtleXMgdG8gc2VydmVycywgd2l0aCB0aGUgc2lnbmF0dXJlXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIChzZXJ2ZXJLZXlzOiBzdHJpbmdbXSwga2V5OiBzdHJpbmcpOiBzdHJpbmdcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgTk9URTogaWYgeW91IG5lZWQgdG8gZG8gc29tZSBleHBlbnNpdmUgaW5pdGlhbGl6YXRpb24sICpwbGVhc2UqIGRvIGl0IGxhemlseSB0aGUgZmlyc3QgdGltZSB5b3UgdGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgd2l0aCBhbiBhcnJheSBvZiBzZXJ2ZXJLZXlzLCBub3Qgb24gZXZlcnkgY2FsbFxuICAgKi9cbiAgc3RhdGljIGNyZWF0ZTxWYWx1ZSwgRXh0cmFzPihcbiAgICBzZXJ2ZXJzU3RyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgb3B0aW9uczogSWZCdWZmZXI8XG4gICAgICBWYWx1ZSxcbiAgICAgIEV4dHJhcyxcbiAgICAgIHVuZGVmaW5lZCB8IChQYXJ0aWFsPFNlcnZlck9wdGlvbnM+ICYgR2l2ZW5DbGllbnRPcHRpb25zPFZhbHVlLCBFeHRyYXM+KSxcbiAgICAgIFBhcnRpYWw8U2VydmVyT3B0aW9ucz4gJiBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz5cbiAgICA+XG4gICk6IENsaWVudDxWYWx1ZSwgRXh0cmFzPiB7XG4gICAgc2VydmVyc1N0ciA9XG4gICAgICBzZXJ2ZXJzU3RyIHx8XG4gICAgICBwcm9jZXNzLmVudi5NRU1DQUNISUVSX1NFUlZFUlMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hFX1NFUlZFUlMgfHxcbiAgICAgIFwibG9jYWxob3N0OjExMjExXCI7XG4gICAgY29uc3Qgc2VydmVyVXJpcyA9IHNlcnZlcnNTdHIuc3BsaXQoXCIsXCIpO1xuICAgIGNvbnN0IHNlcnZlcnMgPSBzZXJ2ZXJVcmlzLm1hcChmdW5jdGlvbiAodXJpKSB7XG4gICAgICBjb25zdCB1cmlQYXJ0cyA9IHVyaS5zcGxpdChcIkBcIik7XG4gICAgICBjb25zdCBob3N0UG9ydCA9IHVyaVBhcnRzW3VyaVBhcnRzLmxlbmd0aCAtIDFdLnNwbGl0KFwiOlwiKTtcbiAgICAgIGNvbnN0IHVzZXJQYXNzID0gKHVyaVBhcnRzW3VyaVBhcnRzLmxlbmd0aCAtIDJdIHx8IFwiXCIpLnNwbGl0KFwiOlwiKTtcbiAgICAgIHJldHVybiBuZXcgU2VydmVyKFxuICAgICAgICBob3N0UG9ydFswXSxcbiAgICAgICAgcGFyc2VJbnQoaG9zdFBvcnRbMV0gfHwgXCIxMTIxMVwiLCAxMCksXG4gICAgICAgIHVzZXJQYXNzWzBdLFxuICAgICAgICB1c2VyUGFzc1sxXSxcbiAgICAgICAgb3B0aW9uc1xuICAgICAgKTtcbiAgICB9KTtcbiAgICByZXR1cm4gbmV3IENsaWVudChzZXJ2ZXJzLCBvcHRpb25zIGFzIGFueSk7XG4gIH1cblxuICAvKipcbiAgICogR2l2ZW4gYSBzZXJ2ZXJLZXkgZnJvbWxvb2t1cEtleVRvU2VydmVyS2V5LCByZXR1cm4gdGhlIGNvcnJlc3BvbmRpbmcgU2VydmVyIGluc3RhbmNlXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gc2VydmVyS2V5XG4gICAqIEByZXR1cm5zIHtTZXJ2ZXJ9XG4gICAqL1xuICBzZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXk6IHN0cmluZyk6IFNlcnZlciB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmVyTWFwW3NlcnZlcktleV07XG4gIH1cblxuICAvKipcbiAgICogR2l2ZW4gYSBrZXkgdG8gbG9vayB1cCBpbiBtZW1jYWNoZSwgcmV0dXJuIGEgc2VydmVyS2V5IChiYXNlZCBvbiBzb21lXG4gICAqIGhhc2hpbmcgZnVuY3Rpb24pIHdoaWNoIGNhbiBiZSB1c2VkIHRvIGluZGV4IHRoaXMuc2VydmVyTWFwXG4gICAqL1xuICBsb29rdXBLZXlUb1NlcnZlcktleShrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5rZXlUb1NlcnZlckhhc2hGdW5jdGlvbih0aGlzLnNlcnZlcktleXMsIGtleSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSB2YWx1ZSBhdCB0aGUgZ2l2ZW4ga2V5IGluIG1lbWNhY2hlLlxuICAgKi9cbiAgYXN5bmMgZ2V0KGtleTogc3RyaW5nKTogUHJvbWlzZTxHZXRSZXN1bHQ8VmFsdWUsIEV4dHJhcz4gfCBudWxsPiB7XG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKGNvbnN0YW50cy5PUF9HRVQsIGtleSwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICBjb25zdCBkZXNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuZGVzZXJpYWxpemUoXG4gICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLm9wY29kZSxcbiAgICAgICAgICByZXNwb25zZS52YWwsXG4gICAgICAgICAgcmVzcG9uc2UuZXh0cmFzXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiB7IC4uLmRlc2VyaWFsaXplZCwgY2FzOiByZXNwb25zZS5oZWFkZXIuY2FzIH07XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkdFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKiogQnVpbGQgYSBwaXBlbGluZWQgZ2V0IG11bHRpIHJlcXVlc3QgYnkgc2VuZGluZyBvbmUgR0VUS1EgZm9yIGVhY2gga2V5IChxdWlldCwgbWVhbmluZyBpdCB3b24ndCByZXNwb25kIGlmIHRoZSB2YWx1ZSBpcyBtaXNzaW5nKSBmb2xsb3dlZCBieSBhIG5vLW9wIHRvIGZvcmNlIGEgcmVzcG9uc2UgKGFuZCB0byBnaXZlIHVzIGEgc2VudGluZWwgcmVzcG9uc2UgdGhhdCB0aGUgcGlwZWxpbmUgaXMgZG9uZSlcbiAgICpcbiAgICogY2YgaHR0cHM6Ly9naXRodWIuY29tL2NvdWNoYmFzZS9tZW1jYWNoZWQvYmxvYi9tYXN0ZXIvZG9jcy9CaW5hcnlQcm90b2NvbC5tZCMweDBkLWdldGtxLWdldC13aXRoLWtleS1xdWlldGx5XG4gICAqL1xuICBfYnVpbGRHZXRNdWx0aVJlcXVlc3Qoa2V5czogc3RyaW5nW10sIHNlcTogbnVtYmVyKTogQnVmZmVyIHtcbiAgICAvLyBzdGFydCBhdCAyNCBmb3IgdGhlIG5vLW9wIGNvbW1hbmQgYXQgdGhlIGVuZFxuICAgIGxldCByZXF1ZXN0U2l6ZSA9IDI0O1xuICAgIGZvciAoY29uc3Qga2V5SWR4IGluIGtleXMpIHtcbiAgICAgIHJlcXVlc3RTaXplICs9IEJ1ZmZlci5ieXRlTGVuZ3RoKGtleXNba2V5SWR4XSwgXCJ1dGY4XCIpICsgMjQ7XG4gICAgfVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IEJ1ZmZlci5hbGxvYyhyZXF1ZXN0U2l6ZSk7XG5cbiAgICBsZXQgYnl0ZXNXcml0dGVuID0gMDtcbiAgICBmb3IgKGNvbnN0IGtleUlkeCBpbiBrZXlzKSB7XG4gICAgICBjb25zdCBrZXkgPSBrZXlzW2tleUlkeF07XG4gICAgICBieXRlc1dyaXR0ZW4gKz0gY29weUludG9SZXF1ZXN0QnVmZmVyKFxuICAgICAgICBjb25zdGFudHMuT1BfR0VUS1EsXG4gICAgICAgIGtleSxcbiAgICAgICAgXCJcIixcbiAgICAgICAgXCJcIixcbiAgICAgICAgc2VxLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICBieXRlc1dyaXR0ZW5cbiAgICAgICk7XG4gICAgfVxuXG4gICAgYnl0ZXNXcml0dGVuICs9IGNvcHlJbnRvUmVxdWVzdEJ1ZmZlcihcbiAgICAgIGNvbnN0YW50cy5PUF9OT19PUCxcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiLFxuICAgICAgXCJcIixcbiAgICAgIHNlcSxcbiAgICAgIHJlcXVlc3QsXG4gICAgICBieXRlc1dyaXR0ZW5cbiAgICApO1xuXG4gICAgcmV0dXJuIHJlcXVlc3Q7XG4gIH1cblxuICAvKiogRXhlY3V0aW5nIGEgcGlwZWxpbmVkIChtdWx0aSkgZ2V0IGFnYWluc3QgYSBzaW5nbGUgc2VydmVyLiBUaGlzIGlzIGEgcHJpdmF0ZSBpbXBsZW1lbnRhdGlvbiBkZXRhaWwgb2YgZ2V0TXVsdGkuICovXG4gIGFzeW5jIF9nZXRNdWx0aVRvU2VydmVyPEtleXMgZXh0ZW5kcyBzdHJpbmc+KFxuICAgIHNlcnY6IFNlcnZlcixcbiAgICBrZXlzOiBLZXlzW11cbiAgKTogUHJvbWlzZTxHZXRNdWx0aVJlc3VsdDxLZXlzLCBWYWx1ZSwgRXh0cmFzPj4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZU1hcDogR2V0TXVsdGlSZXN1bHQ8c3RyaW5nLCBWYWx1ZSwgRXh0cmFzPiA9IHt9O1xuXG4gICAgICBjb25zdCBoYW5kbGU6IE9uUmVzcG9uc2VDYWxsYmFjayA9IChyZXNwb25zZSkgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGdldCB0aGUgbm8tb3AgcmVzcG9uc2UsIHdlIGFyZSBkb25lIHdpdGggdGhpcyBvbmUgZ2V0TXVsdGkgaW4gdGhlIHBlci1iYWNrZW5kIGZhbi1vdXRcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5oZWFkZXIub3Bjb2RlID09PSBjb25zdGFudHMuT1BfTk9fT1ApIHtcbiAgICAgICAgICAgICAgLy8gVGhpcyBlbnN1cmVzIHRoZSBoYW5kbGVyIHdpbGwgYmUgZGVsZXRlZCBmcm9tIHRoZSByZXNwb25zZUNhbGxiYWNrcyBtYXAgaW4gc2VydmVyLmpzXG4gICAgICAgICAgICAgIC8vIFRoaXMgaXNuJ3QgdGVjaG5pY2FsbHkgbmVlZGVkIGhlcmUgYmVjYXVzZSB0aGUgbG9naWMgaW4gc2VydmVyLmpzIGFsc28gY2hlY2tzIGlmIHRvdGFsQm9keUxlbmd0aCA9PT0gMCwgYnV0IG91ciB1bml0dGVzdHMgYXJlbid0IGdyZWF0IGFib3V0IHNldHRpbmcgdGhhdCBmaWVsZCwgYW5kIGFsc28gdGhpcyBtYWtlcyBpdCBtb3JlIGV4cGxpY2l0XG4gICAgICAgICAgICAgIGhhbmRsZS5xdWlldCA9IGZhbHNlO1xuICAgICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlTWFwKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzcG9uc2UuaGVhZGVyLm9wY29kZSA9PT0gY29uc3RhbnRzLk9QX0dFVEsgfHwgcmVzcG9uc2UuaGVhZGVyLm9wY29kZSA9PT0gY29uc3RhbnRzLk9QX0dFVEtRKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5kZXNlcmlhbGl6ZShcbiAgICAgICAgICAgICAgICByZXNwb25zZS5oZWFkZXIub3Bjb2RlLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLnZhbCxcbiAgICAgICAgICAgICAgICByZXNwb25zZS5leHRyYXNcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgY29uc3Qga2V5ID0gcmVzcG9uc2Uua2V5LnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgIGlmIChrZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgICAgIG5ldyBFcnJvcihcIlJlY2lldmVkIGVtcHR5IGtleSBpbiBnZXRNdWx0aTogXCIgKyBKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXNwb25zZU1hcFtrZXldID0geyAuLi5kZXNlcmlhbGl6ZWQsIGNhczogcmVzcG9uc2UuaGVhZGVyLmNhcyB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoXCJSZWNpZXZlZCByZXNwb25zZSBpbiBnZXRNdWx0aSBmb3IgdW5rbm93biBvcGNvZGU6IFwiICsgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJHRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cylcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICAvLyBUaGlzIHByZXZlbnRzIHRoZSBoYW5kbGVyIGZyb20gYmVpbmcgZGVsZXRlZFxuICAgICAgLy8gYWZ0ZXIgdGhlIGZpcnN0IHJlc3BvbnNlLiBMb2dpYyBpbiBzZXJ2ZXIuanMuXG4gICAgICBoYW5kbGUucXVpZXQgPSB0cnVlO1xuXG4gICAgICBjb25zdCBzZXEgPSB0aGlzLmluY3JTZXEoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLl9idWlsZEdldE11bHRpUmVxdWVzdChrZXlzLCBzZXEpO1xuICAgICAgc2Vydi5vblJlc3BvbnNlKHRoaXMuc2VxLCBoYW5kbGUpO1xuICAgICAgc2Vydi5vbkVycm9yKHRoaXMuc2VxLCByZWplY3QpO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2cyB0aGUgdmFsdWUgYXQgdGhlIGdpdmVuIGtleXMgaW4gbWVtY2FjaGVkLiBSZXR1cm5zIGEgbWFwIGZyb20gdGhlXG4gICAqIHJlcXVlc3RlZCBrZXlzIHRvIHJlc3VsdHMsIG9yIG51bGwgaWYgdGhlIGtleSB3YXMgbm90IGZvdW5kLlxuICAgKi9cbiAgYXN5bmMgZ2V0TXVsdGk8S2V5cyBleHRlbmRzIHN0cmluZz4oXG4gICAga2V5czogS2V5c1tdXG4gICk6IFByb21pc2U8R2V0TXVsdGlSZXN1bHQ8S2V5cywgVmFsdWUsIEV4dHJhcz4+IHtcbiAgICBjb25zdCBzZXJ2ZXJLZXl0b0xvb2t1cEtleXM6IHtcbiAgICAgIFtzZXJ2ZXJLZXk6IHN0cmluZ106IHN0cmluZ1tdO1xuICAgIH0gPSB7fTtcbiAgICBrZXlzLmZvckVhY2goKGxvb2t1cEtleSkgPT4ge1xuICAgICAgY29uc3Qgc2VydmVyS2V5ID0gdGhpcy5sb29rdXBLZXlUb1NlcnZlcktleShsb29rdXBLZXkpO1xuICAgICAgaWYgKCFzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSkge1xuICAgICAgICBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSA9IFtdO1xuICAgICAgfVxuICAgICAgc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0ucHVzaChsb29rdXBLZXkpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlZFNlcnZlcktleXMgPSBPYmplY3Qua2V5cyhzZXJ2ZXJLZXl0b0xvb2t1cEtleXMpO1xuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIHVzZWRTZXJ2ZXJLZXlzLm1hcCgoc2VydmVyS2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2VydmVyS2V5VG9TZXJ2ZXIoc2VydmVyS2V5KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldE11bHRpVG9TZXJ2ZXIoc2VydmVyLCBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSk7XG4gICAgICB9KVxuICAgICk7XG5cbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7fSwgLi4ucmVzdWx0cyk7XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBga2V5YCB0byBgdmFsdWVgLlxuICAgKi9cbiAgYXN5bmMgc2V0KFxuICAgIGtleTogc3RyaW5nLFxuICAgIHZhbHVlOiBWYWx1ZSxcbiAgICBvcHRpb25zPzogeyBleHBpcmVzPzogbnVtYmVyOyBjYXM/OiBDQVNUb2tlbiB9XG4gICk6IFByb21pc2U8Ym9vbGVhbiB8IG51bGw+IHtcbiAgICBjb25zdCBleHBpcmVzID0gb3B0aW9ucz8uZXhwaXJlcztcbiAgICBjb25zdCBjYXMgPSBvcHRpb25zPy5jYXM7XG5cbiAgICAvLyBUT0RPOiBzdXBwb3J0IGZsYWdzXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXhwaXJhdGlvbiA9IG1ha2VFeHBpcmF0aW9uKGV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXMpO1xuICAgIGNvbnN0IGV4dHJhcyA9IEJ1ZmZlci5jb25jYXQoW0J1ZmZlci5mcm9tKFwiMDAwMDAwMDBcIiwgXCJoZXhcIiksIGV4cGlyYXRpb25dKTtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShcbiAgICAgIGNvbnN0YW50cy5PUF9TRVQsXG4gICAgICB2YWx1ZSxcbiAgICAgIGV4dHJhc1xuICAgICk7XG4gICAgY29uc3QgcmVxdWVzdCA9IFV0aWxzLmVuY29kZVJlcXVlc3Qoe1xuICAgICAgaGVhZGVyOiB7XG4gICAgICAgIG9wY29kZTogY29uc3RhbnRzLk9QX1NFVCxcbiAgICAgICAgb3BhcXVlOiB0aGlzLnNlcSxcbiAgICAgICAgY2FzLFxuICAgICAgfSxcbiAgICAgIGtleSxcbiAgICAgIHZhbHVlOiBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgZXh0cmFzOiBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICB9KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9FWElTVFM6XG4gICAgICAgIGlmIChjYXMpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlNFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICAgICAgfVxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlNFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQUREXG4gICAqXG4gICAqIEFkZHMgdGhlIGdpdmVuIF9rZXlfIGFuZCBfdmFsdWVfIHRvIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHNcbiAgICogaWYgdGhlIGtleSBpcyBub3QgYWxyZWFkeSBzZXQuXG4gICAqXG4gICAqIFRoZSBvcHRpb25zIGRpY3Rpb25hcnkgdGFrZXM6XG4gICAqICogX2V4cGlyZXNfOiBvdmVycmlkZXMgdGhlIGRlZmF1bHQgZXhwaXJhdGlvbiAoc2VlIGBDbGllbnQuY3JlYXRlYCkgZm9yIHRoaXNcbiAgICogICAgICAgICAgICAgIHBhcnRpY3VsYXIga2V5LXZhbHVlIHBhaXIuXG4gICAqL1xuICBhc3luYyBhZGQoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdmFsdWU6IFZhbHVlLFxuICAgIG9wdGlvbnM/OiB7IGV4cGlyZXM/OiBudW1iZXIgfVxuICApOiBQcm9taXNlPGJvb2xlYW4gfCBudWxsPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCBmbGFncywgc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXhwaXJhdGlvbiA9IG1ha2VFeHBpcmF0aW9uKG9wdGlvbnM/LmV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXMpO1xuICAgIGNvbnN0IGV4dHJhcyA9IEJ1ZmZlci5jb25jYXQoW0J1ZmZlci5mcm9tKFwiMDAwMDAwMDBcIiwgXCJoZXhcIiksIGV4cGlyYXRpb25dKTtcblxuICAgIGNvbnN0IG9wY29kZSA9IGNvbnN0YW50cy5PUF9BREQ7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUob3Bjb2RlLCB2YWx1ZSwgZXh0cmFzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBvcGNvZGUsXG4gICAgICBrZXksXG4gICAgICBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICAgIHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfRVhJU1RTOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkFERFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIGdpdmVuIF9rZXlfIGFuZCBfdmFsdWVfIHRvIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHNcbiAgICogaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHZhbHVlOiBWYWx1ZSxcbiAgICBvcHRpb25zPzogeyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTxib29sZWFuIHwgbnVsbD4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgZmxhZ3MsIHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBtYWtlRXhwaXJhdGlvbihvcHRpb25zPy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCBleHRyYXMgPSBCdWZmZXIuY29uY2F0KFtCdWZmZXIuZnJvbShcIjAwMDAwMDAwXCIsIFwiaGV4XCIpLCBleHBpcmF0aW9uXSk7XG5cbiAgICBjb25zdCBvcGNvZGU6IGNvbnN0YW50cy5PUCA9IGNvbnN0YW50cy5PUF9SRVBMQUNFO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIGV4dHJhcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlJFUExBQ0VcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGhlIGdpdmVuIF9rZXlfIGZyb20gbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkc1xuICAgKiBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcig0LCBrZXksIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcblxuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkRFTEVURVwiLCByZXNwb25zZT8uaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluY3JlbWVudHMgdGhlIGdpdmVuIF9rZXlfIGluIG1lbWNhY2hlLlxuICAgKi9cbiAgYXN5bmMgaW5jcmVtZW50KFxuICAgIGtleTogc3RyaW5nLFxuICAgIGFtb3VudDogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiB7IGluaXRpYWw/OiBudW1iZXI7IGV4cGlyZXM/OiBudW1iZXIgfVxuICApOiBQcm9taXNlPHsgdmFsdWU6IG51bWJlciB8IG51bGw7IHN1Y2Nlc3M6IGJvb2xlYW4gfCBudWxsIH0+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBpbml0aWFsID0gb3B0aW9ucz8uaW5pdGlhbCB8fCAwO1xuICAgIGNvbnN0IGV4cGlyZXMgPSBvcHRpb25zPy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzO1xuICAgIGNvbnN0IGV4dHJhcyA9IG1ha2VBbW91bnRJbml0aWFsQW5kRXhwaXJhdGlvbihhbW91bnQsIGluaXRpYWwsIGV4cGlyZXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIGNvbnN0YW50cy5PUF9JTkNSRU1FTlQsXG4gICAgICBrZXksXG4gICAgICBleHRyYXMsXG4gICAgICBcIlwiLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICBjb25zdCBidWZJbnQgPVxuICAgICAgICAgIChyZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDApIDw8IDgpICsgcmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSg0KTtcbiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJ1ZkludCwgc3VjY2VzczogdHJ1ZSB9O1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIklOQ1JFTUVOVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVjcmVtZW50cyB0aGUgZ2l2ZW4gYGtleWAgaW4gbWVtY2FjaGUuXG4gICAqL1xuICBhc3luYyBkZWNyZW1lbnQoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYW1vdW50OiBudW1iZXIsXG4gICAgb3B0aW9uczogeyBpbml0aWFsPzogbnVtYmVyOyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTx7IHZhbHVlOiBudW1iZXIgfCBudWxsOyBzdWNjZXNzOiBib29sZWFuIHwgbnVsbCB9PiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgaW5pdGlhbCA9IG9wdGlvbnMuaW5pdGlhbCB8fCAwO1xuICAgIGNvbnN0IGV4cGlyZXMgPSBvcHRpb25zLmV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXM7XG4gICAgY29uc3QgZXh0cmFzID0gbWFrZUFtb3VudEluaXRpYWxBbmRFeHBpcmF0aW9uKGFtb3VudCwgaW5pdGlhbCwgZXhwaXJlcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgY29uc3RhbnRzLk9QX0RFQ1JFTUVOVCxcbiAgICAgIGtleSxcbiAgICAgIGV4dHJhcyxcbiAgICAgIFwiXCIsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIGNvbnN0IGJ1ZkludCA9XG4gICAgICAgICAgKHJlc3BvbnNlLnZhbC5yZWFkVUludDMyQkUoMCkgPDwgOCkgKyByZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDQpO1xuICAgICAgICByZXR1cm4geyB2YWx1ZTogYnVmSW50LCBzdWNjZXNzOiB0cnVlIH07XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiREVDUkVNRU5UXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIGdpdmVuIF92YWx1ZV8gdG8gdGhlIHZhbHVlIGFzc29jaWF0ZWQgd2l0aCB0aGUgZ2l2ZW4gX2tleV8gaW5cbiAgICogbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkcyBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGFwcGVuZChrZXk6IHN0cmluZywgdmFsdWU6IFZhbHVlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3Qgb3Bjb2RlOiBjb25zdGFudHMuT1AgPSBjb25zdGFudHMuT1BfQVBQRU5EO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIFwiXCIpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJBUFBFTkRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByZXBlbmQgdGhlIGdpdmVuIF92YWx1ZV8gdG8gdGhlIHZhbHVlIGFzc29jaWF0ZWQgd2l0aCB0aGUgZ2l2ZW4gX2tleV8gaW5cbiAgICogbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkcyBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIHByZXBlbmQoa2V5OiBzdHJpbmcsIHZhbHVlOiBWYWx1ZSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IG9wY29kZTogY29uc3RhbnRzLk9QID0gY29uc3RhbnRzLk9QX1BSRVBFTkQ7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUob3Bjb2RlLCB2YWx1ZSwgXCJcIik7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlBSRVBFTkRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRvdWNoIHNldHMgYW4gZXhwaXJhdGlvbiB2YWx1ZSwgZ2l2ZW4gYnkgX2V4cGlyZXNfLCBvbiB0aGUgZ2l2ZW4gX2tleV8gaW5cbiAgICogbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkcyBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIHRvdWNoKGtleTogc3RyaW5nLCBleHBpcmVzOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBleHRyYXMgPSBtYWtlRXhwaXJhdGlvbihleHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgxYywga2V5LCBleHRyYXMsIFwiXCIsIHRoaXMuc2VxKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJUT1VDSFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRkxVU0hcbiAgICpcbiAgICogRmx1c2hlcyB0aGUgY2FjaGUgb24gZWFjaCBjb25uZWN0ZWQgc2VydmVyLiBUaGUgY2FsbGJhY2sgc2lnbmF0dXJlIGlzOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2sobGFzdEVyciwgcmVzdWx0cylcbiAgICpcbiAgICogd2hlcmUgX2xhc3RFcnJfIGlzIHRoZSBsYXN0IGVycm9yIGVuY291bnRlcmVkIChvciBudWxsLCBpbiB0aGUgY29tbW9uIGNhc2VcbiAgICogb2Ygbm8gZXJyb3JzKS4gX3Jlc3VsdHNfIGlzIGEgZGljdGlvbmFyeSBtYXBwaW5nIGBcImhvc3RuYW1lOnBvcnRcImAgdG8gZWl0aGVyXG4gICAqIGB0cnVlYCAoaWYgdGhlIG9wZXJhdGlvbiB3YXMgc3VjY2Vzc2Z1bCksIG9yIGFuIGVycm9yLlxuICAgKiBAcGFyYW0gY2FsbGJhY2tcbiAgICovXG4gIGZsdXNoKCk6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IEVycm9yPj47XG4gIGZsdXNoKFxuICAgIGNhbGxiYWNrOiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHJlc3VsdHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj5cbiAgICApID0+IHZvaWRcbiAgKTogdm9pZDtcbiAgZmx1c2goXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHJlc3VsdHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj5cbiAgICApID0+IHZvaWRcbiAgKSB7XG4gICAgaWYgKGNhbGxiYWNrID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBwcm9taXNpZnkoKGNhbGxiYWNrKSA9PiB7XG4gICAgICAgIHRoaXMuZmx1c2goZnVuY3Rpb24gKGVyciwgcmVzdWx0cykge1xuICAgICAgICAgIGNhbGxiYWNrKGVyciwgcmVzdWx0cyk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIC8vIFRPRE86IHN1cHBvcnQgZXhwaXJhdGlvblxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDA4LCBcIlwiLCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgbGV0IGNvdW50ID0gdGhpcy5zZXJ2ZXJzLmxlbmd0aDtcbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj4gPSB7fTtcbiAgICBsZXQgbGFzdEVycjogRXJyb3IgfCBudWxsID0gbnVsbDtcblxuICAgIGNvbnN0IGhhbmRsZUZsdXNoID0gZnVuY3Rpb24gKHNlcTogbnVtYmVyLCBzZXJ2OiBTZXJ2ZXIpIHtcbiAgICAgIHNlcnYub25SZXNwb25zZShzZXEsIGZ1bmN0aW9uICgvKiByZXNwb25zZSAqLykge1xuICAgICAgICBjb3VudCAtPSAxO1xuICAgICAgICByZXN1bHRbc2Vydi5ob3N0cG9ydFN0cmluZygpXSA9IHRydWU7XG4gICAgICAgIGlmIChjYWxsYmFjayAmJiBjb3VudCA9PT0gMCkge1xuICAgICAgICAgIGNhbGxiYWNrKGxhc3RFcnIsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgc2Vydi5vbkVycm9yKHNlcSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICBjb3VudCAtPSAxO1xuICAgICAgICBsYXN0RXJyID0gZXJyO1xuICAgICAgICByZXN1bHRbc2Vydi5ob3N0cG9ydFN0cmluZygpXSA9IGVycjtcbiAgICAgICAgaWYgKGNhbGxiYWNrICYmIGNvdW50ID09PSAwKSB7XG4gICAgICAgICAgY2FsbGJhY2sobGFzdEVyciwgcmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBzZXJ2LndyaXRlKHJlcXVlc3QpO1xuICAgIH07XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlRmx1c2godGhpcy5zZXEsIHRoaXMuc2VydmVyc1tpXSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNUQVRTX1dJVEhfS0VZXG4gICAqXG4gICAqIFNlbmRzIGEgbWVtY2FjaGUgc3RhdHMgY29tbWFuZCB3aXRoIGEga2V5IHRvIGVhY2ggY29ubmVjdGVkIHNlcnZlci4gVGhlXG4gICAqIGNhbGxiYWNrIGlzIGludm9rZWQgKipPTkNFIFBFUiBTRVJWRVIqKiBhbmQgaGFzIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhlcnIsIHNlcnZlciwgc3RhdHMpXG4gICAqXG4gICAqIF9zZXJ2ZXJfIGlzIHRoZSBgXCJob3N0bmFtZTpwb3J0XCJgIG9mIHRoZSBzZXJ2ZXIsIGFuZCBfc3RhdHNfIGlzIGEgZGljdGlvbmFyeVxuICAgKiBtYXBwaW5nIHRoZSBzdGF0IG5hbWUgdG8gdGhlIHZhbHVlIG9mIHRoZSBzdGF0aXN0aWMgYXMgYSBzdHJpbmcuXG4gICAqIEBwYXJhbSBrZXlcbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICBzdGF0c1dpdGhLZXkoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHNlcnZlcjogc3RyaW5nLFxuICAgICAgc3RhdHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsXG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDEwLCBrZXksIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTtcblxuICAgIGNvbnN0IGhhbmRsZVN0YXRzID0gKHNlcTogbnVtYmVyLCBzZXJ2OiBTZXJ2ZXIpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgICAgY29uc3QgaGFuZGxlOiBPblJlc3BvbnNlQ2FsbGJhY2sgPSAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgLy8gZW5kIG9mIHN0YXQgcmVzcG9uc2VzXG4gICAgICAgIGlmIChyZXNwb25zZS5oZWFkZXIudG90YWxCb2R5TGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCksIHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyBwcm9jZXNzIHNpbmdsZSBzdGF0IGxpbmUgcmVzcG9uc2VcbiAgICAgICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICAgICAgcmVzdWx0W3Jlc3BvbnNlLmtleS50b1N0cmluZygpXSA9IHJlc3BvbnNlLnZhbC50b1N0cmluZygpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5oYW5kbGVSZXNwb25zZUVycm9yKFxuICAgICAgICAgICAgICBgU1RBVFMgKCR7a2V5fSlgLFxuICAgICAgICAgICAgICByZXNwb25zZS5oZWFkZXIuc3RhdHVzLFxuICAgICAgICAgICAgICB1bmRlZmluZWRcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgY2FsbGJhY2soZXJyb3IsIHNlcnYuaG9zdHBvcnRTdHJpbmcoKSwgbnVsbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBoYW5kbGUucXVpZXQgPSB0cnVlO1xuXG4gICAgICBzZXJ2Lm9uUmVzcG9uc2Uoc2VxLCBoYW5kbGUpO1xuICAgICAgc2Vydi5vbkVycm9yKHNlcSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnIsIHNlcnYuaG9zdHBvcnRTdHJpbmcoKSwgbnVsbCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGhhbmRsZVN0YXRzKHRoaXMuc2VxLCB0aGlzLnNlcnZlcnNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTVEFUU1xuICAgKlxuICAgKiBGZXRjaGVzIG1lbWNhY2hlIHN0YXRzIGZyb20gZWFjaCBjb25uZWN0ZWQgc2VydmVyLiBUaGUgY2FsbGJhY2sgaXMgaW52b2tlZFxuICAgKiAqKk9OQ0UgUEVSIFNFUlZFUioqIGFuZCBoYXMgdGhlIHNpZ25hdHVyZTpcbiAgICpcbiAgICogICAgIGNhbGxiYWNrKGVyciwgc2VydmVyLCBzdGF0cylcbiAgICpcbiAgICogX3NlcnZlcl8gaXMgdGhlIGBcImhvc3RuYW1lOnBvcnRcImAgb2YgdGhlIHNlcnZlciwgYW5kIF9zdGF0c18gaXMgYVxuICAgKiBkaWN0aW9uYXJ5IG1hcHBpbmcgdGhlIHN0YXQgbmFtZSB0byB0aGUgdmFsdWUgb2YgdGhlIHN0YXRpc3RpYyBhcyBhIHN0cmluZy5cbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICBzdGF0cyhcbiAgICBjYWxsYmFjaz86IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgc2VydmVyOiBzdHJpbmcsXG4gICAgICBzdGF0czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IG51bGxcbiAgICApID0+IHZvaWRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0c1dpdGhLZXkoXCJcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgLyoqXG4gICAqIFJFU0VUX1NUQVRTXG4gICAqXG4gICAqIFJlc2V0IHRoZSBzdGF0aXN0aWNzIGVhY2ggc2VydmVyIGlzIGtlZXBpbmcgYmFjayB0byB6ZXJvLiBUaGlzIGRvZXNuJ3QgY2xlYXJcbiAgICogc3RhdHMgc3VjaCBhcyBpdGVtIGNvdW50LCBidXQgdGVtcG9yYXJ5IHN0YXRzIHN1Y2ggYXMgdG90YWwgbnVtYmVyIG9mXG4gICAqIGNvbm5lY3Rpb25zIG92ZXIgdGltZS5cbiAgICpcbiAgICogVGhlIGNhbGxiYWNrIGlzIGludm9rZWQgKipPTkNFIFBFUiBTRVJWRVIqKiBhbmQgaGFzIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhlcnIsIHNlcnZlcilcbiAgICpcbiAgICogX3NlcnZlcl8gaXMgdGhlIGBcImhvc3RuYW1lOnBvcnRcImAgb2YgdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICByZXNldFN0YXRzKFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICBzZXJ2ZXI6IHN0cmluZyxcbiAgICAgIHN0YXRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbFxuICAgICkgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICB0aGlzLnN0YXRzV2l0aEtleShcInJlc2V0XCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBRVUlUXG4gICAqXG4gICAqIENsb3NlcyB0aGUgY29ubmVjdGlvbiB0byBlYWNoIHNlcnZlciwgbm90aWZ5aW5nIHRoZW0gb2YgdGhpcyBpbnRlbnRpb24uIE5vdGVcbiAgICogdGhhdCBxdWl0IGNhbiByYWNlIGFnYWluc3QgYWxyZWFkeSBvdXRzdGFuZGluZyByZXF1ZXN0cyB3aGVuIHRob3NlIHJlcXVlc3RzXG4gICAqIGZhaWwgYW5kIGFyZSByZXRyaWVkLCBsZWFkaW5nIHRvIHRoZSBxdWl0IGNvbW1hbmQgd2lubmluZyBhbmQgY2xvc2luZyB0aGVcbiAgICogY29ubmVjdGlvbiBiZWZvcmUgdGhlIHJldHJpZXMgY29tcGxldGUuXG4gICAqL1xuICBxdWl0KCkge1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIC8vIFRPRE86IE5pY2VyIHBlcmhhcHMgdG8gZG8gUVVJVFEgKDB4MTcpIGJ1dCBuZWVkIGEgbmV3IGNhbGxiYWNrIGZvciB3aGVuXG4gICAgLy8gd3JpdGUgaXMgZG9uZS5cbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgwNywgXCJcIiwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpOyAvLyBRVUlUXG4gICAgbGV0IHNlcnY7XG5cbiAgICBjb25zdCBoYW5kbGVRdWl0ID0gZnVuY3Rpb24gKHNlcTogbnVtYmVyLCBzZXJ2OiBTZXJ2ZXIpIHtcbiAgICAgIHNlcnYub25SZXNwb25zZShzZXEsIGZ1bmN0aW9uICgvKiByZXNwb25zZSAqLykge1xuICAgICAgICBzZXJ2LmNsb3NlKCk7XG4gICAgICB9KTtcbiAgICAgIHNlcnYub25FcnJvcihzZXEsIGZ1bmN0aW9uICgvKiBlcnIgKi8pIHtcbiAgICAgICAgc2Vydi5jbG9zZSgpO1xuICAgICAgfSk7XG4gICAgICBzZXJ2LndyaXRlKHJlcXVlc3QpO1xuICAgIH07XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgc2VydiA9IHRoaXMuc2VydmVyc1tpXTtcbiAgICAgIGhhbmRsZVF1aXQodGhpcy5zZXEsIHNlcnYpO1xuICAgIH1cbiAgfVxuXG4gIF92ZXJzaW9uKHNlcnZlcjogU2VydmVyKTogUHJvbWlzZTx7IHZhbHVlOiBWYWx1ZSB8IG51bGwgfT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLmluY3JTZXEoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgICAgY29uc3RhbnRzLk9QX1ZFUlNJT04sXG4gICAgICAgIFwiXCIsXG4gICAgICAgIFwiXCIsXG4gICAgICAgIFwiXCIsXG4gICAgICAgIHRoaXMuc2VxXG4gICAgICApO1xuICAgICAgdGhpcy5wZXJmb3JtT25TZXJ2ZXIoc2VydmVyLCByZXF1ZXN0LCB0aGlzLnNlcSwgKGVyciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN3aXRjaCAocmVzcG9uc2UhLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgICAgICAvKiBUT0RPOiB0aGlzIGlzIGJ1Z2dlZCwgd2Ugc2hvdWxkJ3QgdXNlIHRoZSBkZXNlcmlhbGl6ZXIgaGVyZSwgc2luY2UgdmVyc2lvbiBhbHdheXMgcmV0dXJucyBhIHZlcnNpb24gc3RyaW5nLlxuICAgICAgICAgICAgIFRoZSBkZXNlcmlhbGl6ZXIgc2hvdWxkIG9ubHkgYmUgdXNlZCBvbiB1c2VyIGtleSBkYXRhLiAqL1xuICAgICAgICAgICAgY29uc3QgZGVzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLmRlc2VyaWFsaXplKFxuICAgICAgICAgICAgICByZXNwb25zZSEuaGVhZGVyLm9wY29kZSxcbiAgICAgICAgICAgICAgcmVzcG9uc2UhLnZhbCxcbiAgICAgICAgICAgICAgcmVzcG9uc2UhLmV4dHJhc1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJldHVybiByZXNvbHZlKHsgdmFsdWU6IGRlc2VyaWFsaXplZC52YWx1ZSB9KTtcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlZFUlNJT05cIiwgcmVzcG9uc2UhLmhlYWRlci5zdGF0dXMpXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0IHRoZSBzZXJ2ZXIgdmVyc2lvbiBmcm9tIHRoZSBcImZpcnN0XCIgc2VydmVyIGluIHRoZSBiYWNrZW5kIHBvb2wuXG4gICAqIFRoZSBzZXJ2ZXIgcmVzcG9uZHMgd2l0aCBhIHBhY2tldCBjb250YWluaW5nIHRoZSB2ZXJzaW9uIHN0cmluZyBpbiB0aGUgYm9keSB3aXRoIHRoZSBmb2xsb3dpbmcgZm9ybWF0OiBcIngueS56XCJcbiAgICovXG4gIHZlcnNpb24oKTogUHJvbWlzZTx7IHZhbHVlOiBWYWx1ZSB8IG51bGwgfT4ge1xuICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2VydmVyS2V5VG9TZXJ2ZXIodGhpcy5zZXJ2ZXJLZXlzWzBdKTtcbiAgICByZXR1cm4gdGhpcy5fdmVyc2lvbihzZXJ2ZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgc2VydmVyIHZlcnNpb24gZnJvbSBhbGwgdGhlIHNlcnZlcnNcbiAgICogaW4gdGhlIGJhY2tlbmQgcG9vbCwgZXJyb3JzIGlmIGFueSBvbmUgb2YgdGhlbSBoYXMgYW5cbiAgICogZXJyb3JcbiAgICovXG4gIGFzeW5jIHZlcnNpb25BbGwoKTogUHJvbWlzZTx7XG4gICAgdmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBWYWx1ZSB8IG51bGw+O1xuICB9PiB7XG4gICAgY29uc3QgdmVyc2lvbk9iamVjdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIHRoaXMuc2VydmVyS2V5cy5tYXAoKHNlcnZlcktleSkgPT4ge1xuICAgICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX3ZlcnNpb24oc2VydmVyKS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgIHJldHVybiB7IHNlcnZlcktleTogc2VydmVyS2V5LCB2YWx1ZTogcmVzcG9uc2UudmFsdWUgfTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgY29uc3QgdmFsdWVzID0gdmVyc2lvbk9iamVjdHMucmVkdWNlKChhY2N1bXVsYXRvciwgdmVyc2lvbk9iamVjdCkgPT4ge1xuICAgICAgYWNjdW11bGF0b3JbdmVyc2lvbk9iamVjdC5zZXJ2ZXJLZXldID0gdmVyc2lvbk9iamVjdC52YWx1ZTtcbiAgICAgIHJldHVybiBhY2N1bXVsYXRvcjtcbiAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBWYWx1ZSB8IG51bGw+KTtcbiAgICByZXR1cm4geyB2YWx1ZXM6IHZhbHVlcyB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyAoYWJydXB0bHkpIGNvbm5lY3Rpb25zIHRvIGFsbCB0aGUgc2VydmVycy5cbiAgICogQHNlZSB0aGlzLnF1aXRcbiAgICovXG4gIGNsb3NlKCkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGlzLnNlcnZlcnNbaV0uY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBhIGdlbmVyaWMgc2luZ2xlIHJlc3BvbnNlIG9wZXJhdGlvbiAoZ2V0LCBzZXQgZXRjKSBvbiBvbmUgc2VydmVyXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgdGhlIGtleSB0byBoYXNoIHRvIGdldCBhIHNlcnZlciBmcm9tIHRoZSBwb29sXG4gICAqIEBwYXJhbSB7YnVmZmVyfSByZXF1ZXN0IGEgYnVmZmVyIGNvbnRhaW5pbmcgdGhlIHJlcXVlc3RcbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlcSB0aGUgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSBvcGVyYXRpb24uIEl0IGlzIHVzZWQgdG8gcGluIHRoZSBjYWxsYmFja3NcbiAgICAgICAgICAgICAgICAgICAgICAgICB0byBhIHNwZWNpZmljIG9wZXJhdGlvbiBhbmQgc2hvdWxkIG5ldmVyIGNoYW5nZSBkdXJpbmcgYSBgcGVyZm9ybWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyP30gcmV0cmllcyBudW1iZXIgb2YgdGltZXMgdG8gcmV0cnkgcmVxdWVzdCBvbiBmYWlsdXJlXG4gICAqL1xuICBwZXJmb3JtKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHJlcXVlc3Q6IEJ1ZmZlcixcbiAgICBzZXE6IG51bWJlcixcbiAgICByZXRyaWVzPzogbnVtYmVyXG4gICk6IFByb21pc2U8TWVzc2FnZT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBzZXJ2ZXJLZXkgPSB0aGlzLmxvb2t1cEtleVRvU2VydmVyS2V5KGtleSk7XG4gICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG5cbiAgICAgIGlmICghc2VydmVyKSB7XG4gICAgICAgIHJldHVybiByZWplY3QobmV3IEVycm9yKFwiTm8gc2VydmVycyBhdmFpbGFibGVcIikpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnBlcmZvcm1PblNlcnZlcihcbiAgICAgICAgc2VydmVyLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICBzZXEsXG4gICAgICAgIChlcnJvciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlISk7XG4gICAgICAgIH0sXG4gICAgICAgIHJldHJpZXNcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwZXJmb3JtT25TZXJ2ZXIoXG4gICAgc2VydmVyOiBTZXJ2ZXIsXG4gICAgcmVxdWVzdDogQnVmZmVyLFxuICAgIHNlcTogbnVtYmVyLFxuICAgIGNhbGxiYWNrOiBSZXNwb25zZU9yRXJyb3JDYWxsYmFjayxcbiAgICByZXRyaWVzOiBudW1iZXIgPSAwXG4gICkge1xuICAgIGNvbnN0IF90aGlzID0gdGhpcztcblxuICAgIHJldHJpZXMgPSByZXRyaWVzIHx8IHRoaXMub3B0aW9ucy5yZXRyaWVzO1xuICAgIGNvbnN0IG9yaWdSZXRyaWVzID0gdGhpcy5vcHRpb25zLnJldHJpZXM7XG4gICAgY29uc3QgbG9nZ2VyID0gdGhpcy5vcHRpb25zLmxvZ2dlcjtcbiAgICBjb25zdCByZXRyeV9kZWxheSA9IHRoaXMub3B0aW9ucy5yZXRyeV9kZWxheTtcblxuICAgIGNvbnN0IHJlc3BvbnNlSGFuZGxlcjogT25SZXNwb25zZUNhbGxiYWNrID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzcG9uc2UpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCBlcnJvckhhbmRsZXI6IE9uRXJyb3JDYWxsYmFjayA9IGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgaWYgKC0tcmV0cmllcyA+IDApIHtcbiAgICAgICAgLy8gV2FpdCBmb3IgcmV0cnlfZGVsYXlcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgX3RoaXMucGVyZm9ybU9uU2VydmVyKHNlcnZlciwgcmVxdWVzdCwgc2VxLCBjYWxsYmFjaywgcmV0cmllcyk7XG4gICAgICAgIH0sIDEwMDAgKiByZXRyeV9kZWxheSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIubG9nKFxuICAgICAgICAgIFwiTWVtSlM6IFNlcnZlciA8XCIgK1xuICAgICAgICAgICAgc2VydmVyLmhvc3Rwb3J0U3RyaW5nKCkgK1xuICAgICAgICAgICAgXCI+IGZhaWxlZCBhZnRlciAoXCIgK1xuICAgICAgICAgICAgb3JpZ1JldHJpZXMgK1xuICAgICAgICAgICAgXCIpIHJldHJpZXMgd2l0aCBlcnJvciAtIFwiICtcbiAgICAgICAgICAgIGVycm9yLm1lc3NhZ2VcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHNlcnZlci5vblJlc3BvbnNlKHNlcSwgcmVzcG9uc2VIYW5kbGVyKTtcbiAgICBzZXJ2ZXIub25FcnJvcihzZXEsIGVycm9ySGFuZGxlcik7XG4gICAgc2VydmVyLndyaXRlKHJlcXVlc3QpO1xuICB9XG5cbiAgLy8gSW5jcmVtZW50IHRoZSBzZXEgdmFsdWVcbiAgaW5jclNlcSgpIHtcbiAgICB0aGlzLnNlcSsrO1xuXG4gICAgLy8gV3JhcCBgdGhpcy5zZXFgIHRvIDMyLWJpdHMgc2luY2UgdGhlIGZpZWxkIHdlIGZpdCBpdCBpbnRvIGlzIG9ubHkgMzItYml0cy5cbiAgICB0aGlzLnNlcSAmPSAweGZmZmZmZmZmO1xuXG4gICAgcmV0dXJuIHRoaXMuc2VxXG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUFuZExvZ0Vycm9yKFxuICAgIGNvbW1hbmROYW1lOiBzdHJpbmcsXG4gICAgcmVzcG9uc2VTdGF0dXM6IFJlc3BvbnNlU3RhdHVzIHwgdW5kZWZpbmVkXG4gICk6IEVycm9yIHtcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgTWVtSlMgJHtjb21tYW5kTmFtZX06ICR7Y29uc3RhbnRzLnJlc3BvbnNlU3RhdHVzVG9TdHJpbmcoXG4gICAgICByZXNwb25zZVN0YXR1c1xuICAgICl9YDtcbiAgICB0aGlzLm9wdGlvbnMubG9nZ2VyLmxvZyhlcnJvck1lc3NhZ2UpO1xuICAgIHJldHVybiBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgYW4gZXJyb3IgdG8gdGhlIGxvZ2dlciwgdGhlbiByZXR1cm4gdGhlIGVycm9yLlxuICAgKiBJZiBhIGNhbGxiYWNrIGlzIGdpdmVuLCBjYWxsIGl0IHdpdGggY2FsbGJhY2soZXJyb3IsIG51bGwpLlxuICAgKi9cbiAgcHJpdmF0ZSBoYW5kbGVSZXNwb25zZUVycm9yKFxuICAgIGNvbW1hbmROYW1lOiBzdHJpbmcsXG4gICAgcmVzcG9uc2VTdGF0dXM6IFJlc3BvbnNlU3RhdHVzIHwgdW5kZWZpbmVkLFxuICAgIGNhbGxiYWNrOiB1bmRlZmluZWQgfCAoKGVycm9yOiBFcnJvciB8IG51bGwsIG90aGVyOiBudWxsKSA9PiB2b2lkKVxuICApOiBFcnJvciB7XG4gICAgY29uc3QgZXJyb3IgPSB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKGNvbW1hbmROYW1lLCByZXNwb25zZVN0YXR1cyk7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhlcnJvciwgbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiBlcnJvcjtcbiAgfVxufVxuXG5leHBvcnQgeyBDbGllbnQsIFNlcnZlciwgVXRpbHMsIEhlYWRlciB9O1xuIl19