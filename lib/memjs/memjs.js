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
    async versionAll(triedCallback, resultCallback) {
        const versionObjects = await Promise.all(this.serverKeys.map((serverKey) => {
            if (triedCallback !== undefined) {
                triedCallback(serverKey);
            }
            const server = this.serverKeyToServer(serverKey);
            return this._version(server).then((response) => {
                if (resultCallback !== undefined) {
                    resultCallback(serverKey);
                }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVtanMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvbWVtanMvbWVtanMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLHdCQUF3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUV4QixxQ0FLa0I7QUFvaUNELHVGQXRpQ2YsZUFBTSxPQXNpQ2U7QUFuaUN2Qix1REFBK0Q7QUFDL0QsbUNBU2lCO0FBQ2pCLHVEQUF5QztBQUN6QywyQ0FBNkM7QUFDN0MsK0NBQWlDO0FBc2hDUixzQkFBSztBQXJoQzlCLGlEQUFtQztBQXFoQ0gsd0JBQU07QUFuaEN0QyxTQUFTLDhCQUE4QixDQUNyQyxPQUFpQixFQUNqQixHQUFXO0lBRVgsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUM3QixNQUFNLEtBQUssR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hCLENBQUM7QUFFRCwrQ0FBK0M7QUFDL0MsU0FBUyxTQUFTLENBQ2hCLE9BQTBFO0lBRTFFLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxPQUFPLEVBQUUsTUFBTTtRQUMxQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUUsTUFBTTtZQUMzQixHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBNkRELE1BQU0sTUFBTTtJQVFWLDRFQUE0RTtJQUM1RSxtQ0FBbUM7SUFDbkMsWUFBWSxPQUFpQixFQUFFLE9BQTBDO1FBQ3ZFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElB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MUMsTUFBTSxZQUFZLEdBQUcsU0FBUyxXQUFXLEtBQUssU0FBUyxDQUFDLHNCQUFzQixDQUM1RSxjQUFjLENBQ2YsRUFBRSxDQUFDO1FBQ0osSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3RDLE9BQU8sSUFBSSxLQUFLLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVEOzs7T0FHRztJQUNLLG1CQUFtQixDQUN6QixXQUFtQixFQUNuQixjQUEwQyxFQUMxQyxRQUFrRTtRQUVsRSxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsV0FBVyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQ2xFLElBQUksUUFBUSxFQUFFO1lBQ1osUUFBUSxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQztTQUN2QjtRQUNELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztDQUNGO0FBRVEsd0JBQU0iLCJzb3VyY2VzQ29udGVudCI6WyIvLyBNZW1UUyBNZW1jYWNoZSBDbGllbnRcblxuaW1wb3J0IHtcbiAgT25FcnJvckNhbGxiYWNrLFxuICBPblJlc3BvbnNlQ2FsbGJhY2ssXG4gIFNlcnZlcixcbiAgU2VydmVyT3B0aW9ucyxcbn0gZnJvbSBcIi4vc2VydmVyXCI7XG5pbXBvcnQgeyBub29wU2VyaWFsaXplciwgU2VyaWFsaXplciB9IGZyb20gXCIuL25vb3Atc2VyaWFsaXplclwiO1xuaW1wb3J0IHtcbiAgbWFrZVJlcXVlc3RCdWZmZXIsXG4gIGNvcHlJbnRvUmVxdWVzdEJ1ZmZlcixcbiAgbWVyZ2UsXG4gIG1ha2VFeHBpcmF0aW9uLFxuICBtYWtlQW1vdW50SW5pdGlhbEFuZEV4cGlyYXRpb24sXG4gIGhhc2hDb2RlLFxuICBNYXliZUJ1ZmZlcixcbiAgTWVzc2FnZSxcbn0gZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCAqIGFzIGNvbnN0YW50cyBmcm9tIFwiLi9jb25zdGFudHNcIjtcbmltcG9ydCB7IFJlc3BvbnNlU3RhdHVzIH0gZnJvbSBcIi4vY29uc3RhbnRzXCI7XG5pbXBvcnQgKiBhcyBVdGlscyBmcm9tIFwiLi91dGlsc1wiO1xuaW1wb3J0ICogYXMgSGVhZGVyIGZyb20gXCIuL2hlYWRlclwiO1xuXG5mdW5jdGlvbiBkZWZhdWx0S2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb24oXG4gIHNlcnZlcnM6IHN0cmluZ1tdLFxuICBrZXk6IHN0cmluZ1xuKTogc3RyaW5nIHtcbiAgY29uc3QgdG90YWwgPSBzZXJ2ZXJzLmxlbmd0aDtcbiAgY29uc3QgaW5kZXggPSB0b3RhbCA+IDEgPyBoYXNoQ29kZShrZXkpICUgdG90YWwgOiAwO1xuICByZXR1cm4gc2VydmVyc1tpbmRleF07XG59XG5cbi8vIGNvbnZlcnRzIGEgY2FsbCBpbnRvIGEgcHJvbWlzZS1yZXR1cm5pbmcgb25lXG5mdW5jdGlvbiBwcm9taXNpZnk8UmVzdWx0PihcbiAgY29tbWFuZDogKGNhbGxiYWNrOiAoZXJyb3I6IEVycm9yIHwgbnVsbCwgcmVzdWx0OiBSZXN1bHQpID0+IHZvaWQpID0+IHZvaWRcbik6IFByb21pc2U8UmVzdWx0PiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgY29tbWFuZChmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICAgIGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZShyZXN1bHQpO1xuICAgIH0pO1xuICB9KTtcbn1cblxudHlwZSBSZXNwb25zZU9yRXJyb3JDYWxsYmFjayA9IChcbiAgZXJyb3I6IEVycm9yIHwgbnVsbCxcbiAgcmVzcG9uc2U6IE1lc3NhZ2UgfCBudWxsXG4pID0+IHZvaWQ7XG5cbmludGVyZmFjZSBCYXNlQ2xpZW50T3B0aW9ucyB7XG4gIHJldHJpZXM6IG51bWJlcjtcbiAgcmV0cnlfZGVsYXk6IG51bWJlcjtcbiAgZXhwaXJlczogbnVtYmVyO1xuICBsb2dnZXI6IHsgbG9nOiB0eXBlb2YgY29uc29sZS5sb2cgfTtcbiAga2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb246IHR5cGVvZiBkZWZhdWx0S2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb247XG59XG5cbmludGVyZmFjZSBTZXJpYWxpemVyUHJvcDxWYWx1ZSwgRXh0cmFzPiB7XG4gIHNlcmlhbGl6ZXI6IFNlcmlhbGl6ZXI8VmFsdWUsIEV4dHJhcz47XG59XG5cbi8qKlxuICogVGhlIGNsaWVudCBoYXMgcGFydGlhbCBzdXBwb3J0IGZvciBzZXJpYWxpemluZyBhbmQgZGVzZXJpYWxpemluZyB2YWx1ZXMgZnJvbSB0aGVcbiAqIEJ1ZmZlciBieXRlIHN0cmluZ3Mgd2UgcmVjaWV2ZSBmcm9tIHRoZSB3aXJlLiBUaGUgZGVmYXVsdCBzZXJpYWxpemVyIGlzIGZvciBNYXliZUJ1ZmZlci5cbiAqXG4gKiBJZiBWYWx1ZSBhbmQgRXh0cmFzIGFyZSBvZiB0eXBlIEJ1ZmZlciwgdGhlbiByZXR1cm4gdHlwZSBXaGVuQnVmZmVyLiBPdGhlcndpc2UsXG4gKiByZXR1cm4gdHlwZSBOb3RCdWZmZXIuXG4gKi9cbnR5cGUgSWZCdWZmZXI8XG4gIFZhbHVlLFxuICBFeHRyYXMsXG4gIFdoZW5WYWx1ZUFuZEV4dHJhc0FyZUJ1ZmZlcnMsXG4gIE5vdEJ1ZmZlclxuPiA9IFZhbHVlIGV4dGVuZHMgQnVmZmVyXG4gID8gRXh0cmFzIGV4dGVuZHMgQnVmZmVyXG4gICAgPyBXaGVuVmFsdWVBbmRFeHRyYXNBcmVCdWZmZXJzXG4gICAgOiBOb3RCdWZmZXJcbiAgOiBOb3RCdWZmZXI7XG5cbmV4cG9ydCB0eXBlIEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPiA9IFBhcnRpYWw8QmFzZUNsaWVudE9wdGlvbnM+ICZcbiAgSWZCdWZmZXI8XG4gICAgVmFsdWUsXG4gICAgRXh0cmFzLFxuICAgIFBhcnRpYWw8U2VyaWFsaXplclByb3A8VmFsdWUsIEV4dHJhcz4+LFxuICAgIFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+XG4gID47XG5cbmV4cG9ydCB0eXBlIENBU1Rva2VuID0gQnVmZmVyO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdldFJlc3VsdDxWYWx1ZSA9IE1heWJlQnVmZmVyLCBFeHRyYXMgPSBNYXliZUJ1ZmZlcj4ge1xuICB2YWx1ZTogVmFsdWU7XG4gIGV4dHJhczogRXh0cmFzO1xuICBjYXM6IENBU1Rva2VuIHwgdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgdHlwZSBHZXRNdWx0aVJlc3VsdDxcbiAgS2V5cyBleHRlbmRzIHN0cmluZyA9IHN0cmluZyxcbiAgVmFsdWUgPSBNYXliZUJ1ZmZlcixcbiAgRXh0cmFzID0gTWF5YmVCdWZmZXJcbj4gPSB7XG4gIFtLIGluIEtleXNdPzogR2V0UmVzdWx0PFZhbHVlLCBFeHRyYXM+O1xufTtcblxuY2xhc3MgQ2xpZW50PFZhbHVlID0gTWF5YmVCdWZmZXIsIEV4dHJhcyA9IE1heWJlQnVmZmVyPiB7XG4gIHNlcnZlcnM6IFNlcnZlcltdO1xuICBzZXE6IG51bWJlcjtcbiAgb3B0aW9uczogQmFzZUNsaWVudE9wdGlvbnMgJiBQYXJ0aWFsPFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+PjtcbiAgc2VyaWFsaXplcjogU2VyaWFsaXplcjxWYWx1ZSwgRXh0cmFzPjtcbiAgc2VydmVyTWFwOiB7IFtob3N0cG9ydDogc3RyaW5nXTogU2VydmVyIH07XG4gIHNlcnZlcktleXM6IHN0cmluZ1tdO1xuXG4gIC8vIENsaWVudCBpbml0aWFsaXplciB0YWtlcyBhIGxpc3Qgb2YgYFNlcnZlcmBzIGFuZCBhbiBgb3B0aW9uc2AgZGljdGlvbmFyeS5cbiAgLy8gU2VlIGBDbGllbnQuY3JlYXRlYCBmb3IgZGV0YWlscy5cbiAgY29uc3RydWN0b3Ioc2VydmVyczogU2VydmVyW10sIG9wdGlvbnM6IEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPikge1xuICAgIHRoaXMuc2VydmVycyA9IHNlcnZlcnM7XG4gICAgdGhpcy5zZXEgPSAwO1xuICAgIHRoaXMub3B0aW9ucyA9IG1lcmdlKG9wdGlvbnMgfHwge30sIHtcbiAgICAgIHJldHJpZXM6IDIsXG4gICAgICByZXRyeV9kZWxheTogMC4yLFxuICAgICAgZXhwaXJlczogMCxcbiAgICAgIGxvZ2dlcjogY29uc29sZSxcbiAgICAgIGtleVRvU2VydmVySGFzaEZ1bmN0aW9uOiBkZWZhdWx0S2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb24sXG4gICAgfSk7XG5cbiAgICB0aGlzLnNlcmlhbGl6ZXIgPSB0aGlzLm9wdGlvbnMuc2VyaWFsaXplciB8fCAobm9vcFNlcmlhbGl6ZXIgYXMgYW55KTtcblxuICAgIC8vIFN0b3JlIGEgbWFwcGluZyBmcm9tIGhvc3Rwb3J0IC0+IHNlcnZlciBzbyB3ZSBjYW4gcXVpY2tseSBnZXQgYSBzZXJ2ZXIgb2JqZWN0IGZyb20gdGhlIHNlcnZlcktleSByZXR1cm5lZCBieSB0aGUgaGFzaGluZyBmdW5jdGlvblxuICAgIGNvbnN0IHNlcnZlck1hcDogeyBbaG9zdHBvcnQ6IHN0cmluZ106IFNlcnZlciB9ID0ge307XG4gICAgdGhpcy5zZXJ2ZXJzLmZvckVhY2goZnVuY3Rpb24gKHNlcnZlcikge1xuICAgICAgc2VydmVyTWFwW3NlcnZlci5ob3N0cG9ydFN0cmluZygpXSA9IHNlcnZlcjtcbiAgICB9KTtcbiAgICB0aGlzLnNlcnZlck1hcCA9IHNlcnZlck1hcDtcblxuICAgIC8vIHN0b3JlIGEgbGlzdCBvZiBhbGwgb3VyIHNlcnZlcktleXMgc28gd2UgZG9uJ3QgbmVlZCB0byBjb25zdGFudGx5IHJlYWxsb2NhdGUgdGhpcyBhcnJheVxuICAgIHRoaXMuc2VydmVyS2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuc2VydmVyTWFwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGNsaWVudCBnaXZlbiBhbiBvcHRpb25hbCBjb25maWcgc3RyaW5nIGFuZCBvcHRpb25hbCBoYXNoIG9mXG4gICAqIG9wdGlvbnMuIFRoZSBjb25maWcgc3RyaW5nIHNob3VsZCBiZSBvZiB0aGUgZm9ybTpcbiAgICpcbiAgICogICAgIFwiW3VzZXI6cGFzc0Bdc2VydmVyMVs6MTEyMTFdLFt1c2VyOnBhc3NAXXNlcnZlcjJbOjExMjExXSwuLi5cIlxuICAgKlxuICAgKiBJZiB0aGUgYXJndW1lbnQgaXMgbm90IGdpdmVuLCBmYWxsYmFjayBvbiB0aGUgYE1FTUNBQ0hJRVJfU0VSVkVSU2AgZW52aXJvbm1lbnRcbiAgICogdmFyaWFibGUsIGBNRU1DQUNIRV9TRVJWRVJTYCBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBgXCJsb2NhbGhvc3Q6MTEyMTFcImAuXG4gICAqXG4gICAqIFRoZSBvcHRpb25zIGhhc2ggbWF5IGNvbnRhaW4gdGhlIG9wdGlvbnM6XG4gICAqXG4gICAqICogYHJldHJpZXNgIC0gdGhlIG51bWJlciBvZiB0aW1lcyB0byByZXRyeSBhbiBvcGVyYXRpb24gaW4gbGlldSBvZiBmYWlsdXJlc1xuICAgKiAoZGVmYXVsdCAyKVxuICAgKiAqIGBleHBpcmVzYCAtIHRoZSBkZWZhdWx0IGV4cGlyYXRpb24gaW4gc2Vjb25kcyB0byB1c2UgKGRlZmF1bHQgMCAtIG5ldmVyXG4gICAqIGV4cGlyZSkuIElmIGBleHBpcmVzYCBpcyBncmVhdGVyIHRoYW4gMzAgZGF5cyAoNjAgeCA2MCB4IDI0IHggMzApLCBpdCBpc1xuICAgKiB0cmVhdGVkIGFzIGEgVU5JWCB0aW1lIChudW1iZXIgb2Ygc2Vjb25kcyBzaW5jZSBKYW51YXJ5IDEsIDE5NzApLlxuICAgKiAqIGBsb2dnZXJgIC0gYSBsb2dnZXIgb2JqZWN0IHRoYXQgcmVzcG9uZHMgdG8gYGxvZyhzdHJpbmcpYCBtZXRob2QgY2FsbHMuXG4gICAqXG4gICAqICAgfn5+flxuICAgKiAgICAgbG9nKG1zZzFbLCBtc2cyWywgbXNnM1suLi5dXV0pXG4gICAqICAgfn5+flxuICAgKlxuICAgKiAgIERlZmF1bHRzIHRvIGBjb25zb2xlYC5cbiAgICogKiBgc2VyaWFsaXplcmAgLSB0aGUgb2JqZWN0IHdoaWNoIHdpbGwgKGRlKXNlcmlhbGl6ZSB0aGUgZGF0YS4gSXQgbmVlZHNcbiAgICogICB0d28gcHVibGljIG1ldGhvZHM6IHNlcmlhbGl6ZSBhbmQgZGVzZXJpYWxpemUuIEl0IGRlZmF1bHRzIHRvIHRoZVxuICAgKiAgIG5vb3BTZXJpYWxpemVyOlxuICAgKlxuICAgKiAgIH5+fn5cbiAgICogICBjb25zdCBub29wU2VyaWFsaXplciA9IHtcbiAgICogICAgIHNlcmlhbGl6ZTogZnVuY3Rpb24gKG9wY29kZSwgdmFsdWUsIGV4dHJhcykge1xuICAgKiAgICAgICByZXR1cm4geyB2YWx1ZTogdmFsdWUsIGV4dHJhczogZXh0cmFzIH07XG4gICAqICAgICB9LFxuICAgKiAgICAgZGVzZXJpYWxpemU6IGZ1bmN0aW9uIChvcGNvZGUsIHZhbHVlLCBleHRyYXMpIHtcbiAgICogICAgICAgcmV0dXJuIHsgdmFsdWU6IHZhbHVlLCBleHRyYXM6IGV4dHJhcyB9O1xuICAgKiAgICAgfVxuICAgKiAgIH07XG4gICAqICAgfn5+flxuICAgKlxuICAgKiBPciBvcHRpb25zIGZvciB0aGUgc2VydmVycyBpbmNsdWRpbmc6XG4gICAqICogYHVzZXJuYW1lYCBhbmQgYHBhc3N3b3JkYCBmb3IgZmFsbGJhY2sgU0FTTCBhdXRoZW50aWNhdGlvbiBjcmVkZW50aWFscy5cbiAgICogKiBgdGltZW91dGAgaW4gc2Vjb25kcyB0byBkZXRlcm1pbmUgZmFpbHVyZSBmb3Igb3BlcmF0aW9ucy4gRGVmYXVsdCBpcyAwLjVcbiAgICogICAgICAgICAgICAgc2Vjb25kcy5cbiAgICogKiAnY29ubnRpbWVvdXQnIGluIHNlY29uZHMgdG8gY29ubmVjdGlvbiBmYWlsdXJlLiBEZWZhdWx0IGlzIHR3aWNlIHRoZSB2YWx1ZVxuICAgKiAgICAgICAgICAgICAgICAgb2YgYHRpbWVvdXRgLlxuICAgKiAqIGBrZWVwQWxpdmVgIHdoZXRoZXIgdG8gZW5hYmxlIGtlZXAtYWxpdmUgZnVuY3Rpb25hbGl0eS4gRGVmYXVsdHMgdG8gZmFsc2UuXG4gICAqICogYGtlZXBBbGl2ZURlbGF5YCBpbiBzZWNvbmRzIHRvIHRoZSBpbml0aWFsIGRlbGF5IGJlZm9yZSB0aGUgZmlyc3Qga2VlcGFsaXZlXG4gICAqICAgICAgICAgICAgICAgICAgICBwcm9iZSBpcyBzZW50IG9uIGFuIGlkbGUgc29ja2V0LiBEZWZhdWx0cyBpcyAzMCBzZWNvbmRzLlxuICAgKiAqIGBrZXlUb1NlcnZlckhhc2hGdW5jdGlvbmAgYSBmdW5jdGlvbiB0byBtYXAga2V5cyB0byBzZXJ2ZXJzLCB3aXRoIHRoZSBzaWduYXR1cmVcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgKHNlcnZlcktleXM6IHN0cmluZ1tdLCBrZXk6IHN0cmluZyk6IHN0cmluZ1xuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBOT1RFOiBpZiB5b3UgbmVlZCB0byBkbyBzb21lIGV4cGVuc2l2ZSBpbml0aWFsaXphdGlvbiwgKnBsZWFzZSogZG8gaXQgbGF6aWx5IHRoZSBmaXJzdCB0aW1lIHlvdSB0aGlzIGZ1bmN0aW9uIGlzIGNhbGxlZCB3aXRoIGFuIGFycmF5IG9mIHNlcnZlcktleXMsIG5vdCBvbiBldmVyeSBjYWxsXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlPFZhbHVlLCBFeHRyYXM+KFxuICAgIHNlcnZlcnNTdHI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICBvcHRpb25zOiBJZkJ1ZmZlcjxcbiAgICAgIFZhbHVlLFxuICAgICAgRXh0cmFzLFxuICAgICAgdW5kZWZpbmVkIHwgKFBhcnRpYWw8U2VydmVyT3B0aW9ucz4gJiBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz4pLFxuICAgICAgUGFydGlhbDxTZXJ2ZXJPcHRpb25zPiAmIEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPlxuICAgID5cbiAgKTogQ2xpZW50PFZhbHVlLCBFeHRyYXM+IHtcbiAgICBzZXJ2ZXJzU3RyID1cbiAgICAgIHNlcnZlcnNTdHIgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hJRVJfU0VSVkVSUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSEVfU0VSVkVSUyB8fFxuICAgICAgXCJsb2NhbGhvc3Q6MTEyMTFcIjtcbiAgICBjb25zdCBzZXJ2ZXJVcmlzID0gc2VydmVyc1N0ci5zcGxpdChcIixcIik7XG4gICAgY29uc3Qgc2VydmVycyA9IHNlcnZlclVyaXMubWFwKGZ1bmN0aW9uICh1cmkpIHtcbiAgICAgIGNvbnN0IHVyaVBhcnRzID0gdXJpLnNwbGl0KFwiQFwiKTtcbiAgICAgIGNvbnN0IGhvc3RQb3J0ID0gdXJpUGFydHNbdXJpUGFydHMubGVuZ3RoIC0gMV0uc3BsaXQoXCI6XCIpO1xuICAgICAgY29uc3QgdXNlclBhc3MgPSAodXJpUGFydHNbdXJpUGFydHMubGVuZ3RoIC0gMl0gfHwgXCJcIikuc3BsaXQoXCI6XCIpO1xuICAgICAgcmV0dXJuIG5ldyBTZXJ2ZXIoXG4gICAgICAgIGhvc3RQb3J0WzBdLFxuICAgICAgICBwYXJzZUludChob3N0UG9ydFsxXSB8fCBcIjExMjExXCIsIDEwKSxcbiAgICAgICAgdXNlclBhc3NbMF0sXG4gICAgICAgIHVzZXJQYXNzWzFdLFxuICAgICAgICBvcHRpb25zXG4gICAgICApO1xuICAgIH0pO1xuICAgIHJldHVybiBuZXcgQ2xpZW50KHNlcnZlcnMsIG9wdGlvbnMgYXMgYW55KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHaXZlbiBhIHNlcnZlcktleSBmcm9tbG9va3VwS2V5VG9TZXJ2ZXJLZXksIHJldHVybiB0aGUgY29ycmVzcG9uZGluZyBTZXJ2ZXIgaW5zdGFuY2VcbiAgICpcbiAgICogQHBhcmFtICB7c3RyaW5nfSBzZXJ2ZXJLZXlcbiAgICogQHJldHVybnMge1NlcnZlcn1cbiAgICovXG4gIHNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleTogc3RyaW5nKTogU2VydmVyIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2ZXJNYXBbc2VydmVyS2V5XTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHaXZlbiBhIGtleSB0byBsb29rIHVwIGluIG1lbWNhY2hlLCByZXR1cm4gYSBzZXJ2ZXJLZXkgKGJhc2VkIG9uIHNvbWVcbiAgICogaGFzaGluZyBmdW5jdGlvbikgd2hpY2ggY2FuIGJlIHVzZWQgdG8gaW5kZXggdGhpcy5zZXJ2ZXJNYXBcbiAgICovXG4gIGxvb2t1cEtleVRvU2VydmVyS2V5KGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLmtleVRvU2VydmVySGFzaEZ1bmN0aW9uKHRoaXMuc2VydmVyS2V5cywga2V5KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIHZhbHVlIGF0IHRoZSBnaXZlbiBrZXkgaW4gbWVtY2FjaGUuXG4gICAqL1xuICBhc3luYyBnZXQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPEdldFJlc3VsdDxWYWx1ZSwgRXh0cmFzPiB8IG51bGw+IHtcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoY29uc3RhbnRzLk9QX0dFVCwga2V5LCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIGNvbnN0IGRlc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5kZXNlcmlhbGl6ZShcbiAgICAgICAgICByZXNwb25zZS5oZWFkZXIub3Bjb2RlLFxuICAgICAgICAgIHJlc3BvbnNlLnZhbCxcbiAgICAgICAgICByZXNwb25zZS5leHRyYXNcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIHsgLi4uZGVzZXJpYWxpemVkLCBjYXM6IHJlc3BvbnNlLmhlYWRlci5jYXMgfTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiR0VUXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBCdWlsZCBhIHBpcGVsaW5lZCBnZXQgbXVsdGkgcmVxdWVzdCBieSBzZW5kaW5nIG9uZSBHRVRLUSBmb3IgZWFjaCBrZXkgKHF1aWV0LCBtZWFuaW5nIGl0IHdvbid0IHJlc3BvbmQgaWYgdGhlIHZhbHVlIGlzIG1pc3NpbmcpIGZvbGxvd2VkIGJ5IGEgbm8tb3AgdG8gZm9yY2UgYSByZXNwb25zZSAoYW5kIHRvIGdpdmUgdXMgYSBzZW50aW5lbCByZXNwb25zZSB0aGF0IHRoZSBwaXBlbGluZSBpcyBkb25lKVxuICAgKlxuICAgKiBjZiBodHRwczovL2dpdGh1Yi5jb20vY291Y2hiYXNlL21lbWNhY2hlZC9ibG9iL21hc3Rlci9kb2NzL0JpbmFyeVByb3RvY29sLm1kIzB4MGQtZ2V0a3EtZ2V0LXdpdGgta2V5LXF1aWV0bHlcbiAgICovXG4gIF9idWlsZEdldE11bHRpUmVxdWVzdChrZXlzOiBzdHJpbmdbXSwgc2VxOiBudW1iZXIpOiBCdWZmZXIge1xuICAgIC8vIHN0YXJ0IGF0IDI0IGZvciB0aGUgbm8tb3AgY29tbWFuZCBhdCB0aGUgZW5kXG4gICAgbGV0IHJlcXVlc3RTaXplID0gMjQ7XG4gICAgZm9yIChjb25zdCBrZXlJZHggaW4ga2V5cykge1xuICAgICAgcmVxdWVzdFNpemUgKz0gQnVmZmVyLmJ5dGVMZW5ndGgoa2V5c1trZXlJZHhdLCBcInV0ZjhcIikgKyAyNDtcbiAgICB9XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gQnVmZmVyLmFsbG9jKHJlcXVlc3RTaXplKTtcblxuICAgIGxldCBieXRlc1dyaXR0ZW4gPSAwO1xuICAgIGZvciAoY29uc3Qga2V5SWR4IGluIGtleXMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGtleXNba2V5SWR4XTtcbiAgICAgIGJ5dGVzV3JpdHRlbiArPSBjb3B5SW50b1JlcXVlc3RCdWZmZXIoXG4gICAgICAgIGNvbnN0YW50cy5PUF9HRVRLUSxcbiAgICAgICAga2V5LFxuICAgICAgICBcIlwiLFxuICAgICAgICBcIlwiLFxuICAgICAgICBzZXEsXG4gICAgICAgIHJlcXVlc3QsXG4gICAgICAgIGJ5dGVzV3JpdHRlblxuICAgICAgKTtcbiAgICB9XG5cbiAgICBieXRlc1dyaXR0ZW4gKz0gY29weUludG9SZXF1ZXN0QnVmZmVyKFxuICAgICAgY29uc3RhbnRzLk9QX05PX09QLFxuICAgICAgXCJcIixcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiLFxuICAgICAgc2VxLFxuICAgICAgcmVxdWVzdCxcbiAgICAgIGJ5dGVzV3JpdHRlblxuICAgICk7XG5cbiAgICByZXR1cm4gcmVxdWVzdDtcbiAgfVxuXG4gIC8qKiBFeGVjdXRpbmcgYSBwaXBlbGluZWQgKG11bHRpKSBnZXQgYWdhaW5zdCBhIHNpbmdsZSBzZXJ2ZXIuIFRoaXMgaXMgYSBwcml2YXRlIGltcGxlbWVudGF0aW9uIGRldGFpbCBvZiBnZXRNdWx0aS4gKi9cbiAgYXN5bmMgX2dldE11bHRpVG9TZXJ2ZXI8S2V5cyBleHRlbmRzIHN0cmluZz4oXG4gICAgc2VydjogU2VydmVyLFxuICAgIGtleXM6IEtleXNbXVxuICApOiBQcm9taXNlPEdldE11bHRpUmVzdWx0PEtleXMsIFZhbHVlLCBFeHRyYXM+PiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlTWFwOiBHZXRNdWx0aVJlc3VsdDxzdHJpbmcsIFZhbHVlLCBFeHRyYXM+ID0ge307XG5cbiAgICAgIGNvbnN0IGhhbmRsZTogT25SZXNwb25zZUNhbGxiYWNrID0gKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgZ2V0IHRoZSBuby1vcCByZXNwb25zZSwgd2UgYXJlIGRvbmUgd2l0aCB0aGlzIG9uZSBnZXRNdWx0aSBpbiB0aGUgcGVyLWJhY2tlbmQgZmFuLW91dFxuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IGNvbnN0YW50cy5PUF9OT19PUCkge1xuICAgICAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgdGhlIGhhbmRsZXIgd2lsbCBiZSBkZWxldGVkIGZyb20gdGhlIHJlc3BvbnNlQ2FsbGJhY2tzIG1hcCBpbiBzZXJ2ZXIuanNcbiAgICAgICAgICAgICAgLy8gVGhpcyBpc24ndCB0ZWNobmljYWxseSBuZWVkZWQgaGVyZSBiZWNhdXNlIHRoZSBsb2dpYyBpbiBzZXJ2ZXIuanMgYWxzbyBjaGVja3MgaWYgdG90YWxCb2R5TGVuZ3RoID09PSAwLCBidXQgb3VyIHVuaXR0ZXN0cyBhcmVuJ3QgZ3JlYXQgYWJvdXQgc2V0dGluZyB0aGF0IGZpZWxkLCBhbmQgYWxzbyB0aGlzIG1ha2VzIGl0IG1vcmUgZXhwbGljaXRcbiAgICAgICAgICAgICAgaGFuZGxlLnF1aWV0ID0gZmFsc2U7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2VNYXApO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5oZWFkZXIub3Bjb2RlID09PSBjb25zdGFudHMuT1BfR0VUSyB8fCByZXNwb25zZS5oZWFkZXIub3Bjb2RlID09PSBjb25zdGFudHMuT1BfR0VUS1EpIHtcbiAgICAgICAgICAgICAgY29uc3QgZGVzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLmRlc2VyaWFsaXplKFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmhlYWRlci5vcGNvZGUsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2UudmFsLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmV4dHJhc1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBjb25zdCBrZXkgPSByZXNwb25zZS5rZXkudG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgaWYgKGtleS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICAgICAgbmV3IEVycm9yKFwiUmVjaWV2ZWQgZW1wdHkga2V5IGluIGdldE11bHRpOiBcIiArIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSlcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlc3BvbnNlTWFwW2tleV0gPSB7IC4uLmRlc2VyaWFsaXplZCwgY2FzOiByZXNwb25zZS5oZWFkZXIuY2FzIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihcIlJlY2lldmVkIHJlc3BvbnNlIGluIGdldE11bHRpIGZvciB1bmtub3duIG9wY29kZTogXCIgKyBKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkdFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIC8vIFRoaXMgcHJldmVudHMgdGhlIGhhbmRsZXIgZnJvbSBiZWluZyBkZWxldGVkXG4gICAgICAvLyBhZnRlciB0aGUgZmlyc3QgcmVzcG9uc2UuIExvZ2ljIGluIHNlcnZlci5qcy5cbiAgICAgIGhhbmRsZS5xdWlldCA9IHRydWU7XG5cbiAgICAgIGNvbnN0IHNlcSA9IHRoaXMuaW5jclNlcSgpO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IHRoaXMuX2J1aWxkR2V0TXVsdGlSZXF1ZXN0KGtleXMsIHNlcSk7XG4gICAgICBzZXJ2Lm9uUmVzcG9uc2UodGhpcy5zZXEsIGhhbmRsZSk7XG4gICAgICBzZXJ2Lm9uRXJyb3IodGhpcy5zZXEsIHJlamVjdCk7XG4gICAgICBzZXJ2LndyaXRlKHJlcXVlc3QpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZzIHRoZSB2YWx1ZSBhdCB0aGUgZ2l2ZW4ga2V5cyBpbiBtZW1jYWNoZWQuIFJldHVybnMgYSBtYXAgZnJvbSB0aGVcbiAgICogcmVxdWVzdGVkIGtleXMgdG8gcmVzdWx0cywgb3IgbnVsbCBpZiB0aGUga2V5IHdhcyBub3QgZm91bmQuXG4gICAqL1xuICBhc3luYyBnZXRNdWx0aTxLZXlzIGV4dGVuZHMgc3RyaW5nPihcbiAgICBrZXlzOiBLZXlzW11cbiAgKTogUHJvbWlzZTxHZXRNdWx0aVJlc3VsdDxLZXlzLCBWYWx1ZSwgRXh0cmFzPj4ge1xuICAgIGNvbnN0IHNlcnZlcktleXRvTG9va3VwS2V5czoge1xuICAgICAgW3NlcnZlcktleTogc3RyaW5nXTogc3RyaW5nW107XG4gICAgfSA9IHt9O1xuICAgIGtleXMuZm9yRWFjaCgobG9va3VwS2V5KSA9PiB7XG4gICAgICBjb25zdCBzZXJ2ZXJLZXkgPSB0aGlzLmxvb2t1cEtleVRvU2VydmVyS2V5KGxvb2t1cEtleSk7XG4gICAgICBpZiAoIXNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldKSB7XG4gICAgICAgIHNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldID0gW107XG4gICAgICB9XG4gICAgICBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XS5wdXNoKGxvb2t1cEtleSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCB1c2VkU2VydmVyS2V5cyA9IE9iamVjdC5rZXlzKHNlcnZlcktleXRvTG9va3VwS2V5cyk7XG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgdXNlZFNlcnZlcktleXMubWFwKChzZXJ2ZXJLZXkpID0+IHtcbiAgICAgICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXkpO1xuICAgICAgICByZXR1cm4gdGhpcy5fZ2V0TXVsdGlUb1NlcnZlcihzZXJ2ZXIsIHNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldKTtcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCAuLi5yZXN1bHRzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGBrZXlgIHRvIGB2YWx1ZWAuXG4gICAqL1xuICBhc3luYyBzZXQoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdmFsdWU6IFZhbHVlLFxuICAgIG9wdGlvbnM/OiB7IGV4cGlyZXM/OiBudW1iZXI7IGNhcz86IENBU1Rva2VuIH1cbiAgKTogUHJvbWlzZTxib29sZWFuIHwgbnVsbD4ge1xuICAgIGNvbnN0IGV4cGlyZXMgPSBvcHRpb25zPy5leHBpcmVzO1xuICAgIGNvbnN0IGNhcyA9IG9wdGlvbnM/LmNhcztcblxuICAgIC8vIFRPRE86IHN1cHBvcnQgZmxhZ3NcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBleHBpcmF0aW9uID0gbWFrZUV4cGlyYXRpb24oZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcyk7XG4gICAgY29uc3QgZXh0cmFzID0gQnVmZmVyLmNvbmNhdChbQnVmZmVyLmZyb20oXCIwMDAwMDAwMFwiLCBcImhleFwiKSwgZXhwaXJhdGlvbl0pO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKFxuICAgICAgY29uc3RhbnRzLk9QX1NFVCxcbiAgICAgIHZhbHVlLFxuICAgICAgZXh0cmFzXG4gICAgKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gVXRpbHMuZW5jb2RlUmVxdWVzdCh7XG4gICAgICBoZWFkZXI6IHtcbiAgICAgICAgb3Bjb2RlOiBjb25zdGFudHMuT1BfU0VULFxuICAgICAgICBvcGFxdWU6IHRoaXMuc2VxLFxuICAgICAgICBjYXMsXG4gICAgICB9LFxuICAgICAga2V5LFxuICAgICAgdmFsdWU6IHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICBleHRyYXM6IHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX0VYSVNUUzpcbiAgICAgICAgaWYgKGNhcykge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiU0VUXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgICAgICB9XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiU0VUXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBRERcbiAgICpcbiAgICogQWRkcyB0aGUgZ2l2ZW4gX2tleV8gYW5kIF92YWx1ZV8gdG8gbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkc1xuICAgKiBpZiB0aGUga2V5IGlzIG5vdCBhbHJlYWR5IHNldC5cbiAgICpcbiAgICogVGhlIG9wdGlvbnMgZGljdGlvbmFyeSB0YWtlczpcbiAgICogKiBfZXhwaXJlc186IG92ZXJyaWRlcyB0aGUgZGVmYXVsdCBleHBpcmF0aW9uIChzZWUgYENsaWVudC5jcmVhdGVgKSBmb3IgdGhpc1xuICAgKiAgICAgICAgICAgICAgcGFydGljdWxhciBrZXktdmFsdWUgcGFpci5cbiAgICovXG4gIGFzeW5jIGFkZChcbiAgICBrZXk6IHN0cmluZyxcbiAgICB2YWx1ZTogVmFsdWUsXG4gICAgb3B0aW9ucz86IHsgZXhwaXJlcz86IG51bWJlciB9XG4gICk6IFByb21pc2U8Ym9vbGVhbiB8IG51bGw+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IGZsYWdzLCBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBleHBpcmF0aW9uID0gbWFrZUV4cGlyYXRpb24ob3B0aW9ucz8uZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcyk7XG4gICAgY29uc3QgZXh0cmFzID0gQnVmZmVyLmNvbmNhdChbQnVmZmVyLmZyb20oXCIwMDAwMDAwMFwiLCBcImhleFwiKSwgZXhwaXJhdGlvbl0pO1xuXG4gICAgY29uc3Qgb3Bjb2RlID0gY29uc3RhbnRzLk9QX0FERDtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShvcGNvZGUsIHZhbHVlLCBleHRyYXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9FWElTVFM6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiQUREXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgZ2l2ZW4gX2tleV8gYW5kIF92YWx1ZV8gdG8gbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkc1xuICAgKiBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2UoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdmFsdWU6IFZhbHVlLFxuICAgIG9wdGlvbnM/OiB7IGV4cGlyZXM/OiBudW1iZXIgfVxuICApOiBQcm9taXNlPGJvb2xlYW4gfCBudWxsPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCBmbGFncywgc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXhwaXJhdGlvbiA9IG1ha2VFeHBpcmF0aW9uKG9wdGlvbnM/LmV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXMpO1xuICAgIGNvbnN0IGV4dHJhcyA9IEJ1ZmZlci5jb25jYXQoW0J1ZmZlci5mcm9tKFwiMDAwMDAwMDBcIiwgXCJoZXhcIiksIGV4cGlyYXRpb25dKTtcblxuICAgIGNvbnN0IG9wY29kZTogY29uc3RhbnRzLk9QID0gY29uc3RhbnRzLk9QX1JFUExBQ0U7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUob3Bjb2RlLCB2YWx1ZSwgZXh0cmFzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBvcGNvZGUsXG4gICAgICBrZXksXG4gICAgICBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICAgIHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiUkVQTEFDRVwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0aGUgZ2l2ZW4gX2tleV8gZnJvbSBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzXG4gICAqIGlmIHRoZSBrZXkgaXMgYWxyZWFkeSBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlKGtleTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLy8gVE9ETzogU3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDQsIGtleSwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuXG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiREVMRVRFXCIsIHJlc3BvbnNlPy5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5jcmVtZW50cyB0aGUgZ2l2ZW4gX2tleV8gaW4gbWVtY2FjaGUuXG4gICAqL1xuICBhc3luYyBpbmNyZW1lbnQoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYW1vdW50OiBudW1iZXIsXG4gICAgb3B0aW9ucz86IHsgaW5pdGlhbD86IG51bWJlcjsgZXhwaXJlcz86IG51bWJlciB9XG4gICk6IFByb21pc2U8eyB2YWx1ZTogbnVtYmVyIHwgbnVsbDsgc3VjY2VzczogYm9vbGVhbiB8IG51bGwgfT4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGluaXRpYWwgPSBvcHRpb25zPy5pbml0aWFsIHx8IDA7XG4gICAgY29uc3QgZXhwaXJlcyA9IG9wdGlvbnM/LmV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXM7XG4gICAgY29uc3QgZXh0cmFzID0gbWFrZUFtb3VudEluaXRpYWxBbmRFeHBpcmF0aW9uKGFtb3VudCwgaW5pdGlhbCwgZXhwaXJlcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgY29uc3RhbnRzLk9QX0lOQ1JFTUVOVCxcbiAgICAgIGtleSxcbiAgICAgIGV4dHJhcyxcbiAgICAgIFwiXCIsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIGNvbnN0IGJ1ZkludCA9XG4gICAgICAgICAgKHJlc3BvbnNlLnZhbC5yZWFkVUludDMyQkUoMCkgPDwgOCkgKyByZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDQpO1xuICAgICAgICByZXR1cm4geyB2YWx1ZTogYnVmSW50LCBzdWNjZXNzOiB0cnVlIH07XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiSU5DUkVNRU5UXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNyZW1lbnRzIHRoZSBnaXZlbiBga2V5YCBpbiBtZW1jYWNoZS5cbiAgICovXG4gIGFzeW5jIGRlY3JlbWVudChcbiAgICBrZXk6IHN0cmluZyxcbiAgICBhbW91bnQ6IG51bWJlcixcbiAgICBvcHRpb25zOiB7IGluaXRpYWw/OiBudW1iZXI7IGV4cGlyZXM/OiBudW1iZXIgfVxuICApOiBQcm9taXNlPHsgdmFsdWU6IG51bWJlciB8IG51bGw7IHN1Y2Nlc3M6IGJvb2xlYW4gfCBudWxsIH0+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBpbml0aWFsID0gb3B0aW9ucy5pbml0aWFsIHx8IDA7XG4gICAgY29uc3QgZXhwaXJlcyA9IG9wdGlvbnMuZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcztcbiAgICBjb25zdCBleHRyYXMgPSBtYWtlQW1vdW50SW5pdGlhbEFuZEV4cGlyYXRpb24oYW1vdW50LCBpbml0aWFsLCBleHBpcmVzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBjb25zdGFudHMuT1BfREVDUkVNRU5ULFxuICAgICAga2V5LFxuICAgICAgZXh0cmFzLFxuICAgICAgXCJcIixcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgY29uc3QgYnVmSW50ID1cbiAgICAgICAgICAocmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSgwKSA8PCA4KSArIHJlc3BvbnNlLnZhbC5yZWFkVUludDMyQkUoNCk7XG4gICAgICAgIHJldHVybiB7IHZhbHVlOiBidWZJbnQsIHN1Y2Nlc3M6IHRydWUgfTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJERUNSRU1FTlRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgZ2l2ZW4gX3ZhbHVlXyB0byB0aGUgdmFsdWUgYXNzb2NpYXRlZCB3aXRoIHRoZSBnaXZlbiBfa2V5XyBpblxuICAgKiBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzIGlmIHRoZSBrZXkgaXMgYWxyZWFkeSBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgYXBwZW5kKGtleTogc3RyaW5nLCB2YWx1ZTogVmFsdWUpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBvcGNvZGU6IGNvbnN0YW50cy5PUCA9IGNvbnN0YW50cy5PUF9BUFBFTkQ7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUob3Bjb2RlLCB2YWx1ZSwgXCJcIik7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkFQUEVORFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJlcGVuZCB0aGUgZ2l2ZW4gX3ZhbHVlXyB0byB0aGUgdmFsdWUgYXNzb2NpYXRlZCB3aXRoIHRoZSBnaXZlbiBfa2V5XyBpblxuICAgKiBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzIGlmIHRoZSBrZXkgaXMgYWxyZWFkeSBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgcHJlcGVuZChrZXk6IHN0cmluZywgdmFsdWU6IFZhbHVlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3Qgb3Bjb2RlOiBjb25zdGFudHMuT1AgPSBjb25zdGFudHMuT1BfUFJFUEVORDtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShvcGNvZGUsIHZhbHVlLCBcIlwiKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBvcGNvZGUsXG4gICAgICBrZXksXG4gICAgICBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICAgIHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiUFJFUEVORFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVG91Y2ggc2V0cyBhbiBleHBpcmF0aW9uIHZhbHVlLCBnaXZlbiBieSBfZXhwaXJlc18sIG9uIHRoZSBnaXZlbiBfa2V5XyBpblxuICAgKiBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzIGlmIHRoZSBrZXkgaXMgYWxyZWFkeSBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgdG91Y2goa2V5OiBzdHJpbmcsIGV4cGlyZXM6IG51bWJlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4dHJhcyA9IG1ha2VFeHBpcmF0aW9uKGV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDFjLCBrZXksIGV4dHJhcywgXCJcIiwgdGhpcy5zZXEpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlRPVUNIXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGTFVTSFxuICAgKlxuICAgKiBGbHVzaGVzIHRoZSBjYWNoZSBvbiBlYWNoIGNvbm5lY3RlZCBzZXJ2ZXIuIFRoZSBjYWxsYmFjayBzaWduYXR1cmUgaXM6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhsYXN0RXJyLCByZXN1bHRzKVxuICAgKlxuICAgKiB3aGVyZSBfbGFzdEVycl8gaXMgdGhlIGxhc3QgZXJyb3IgZW5jb3VudGVyZWQgKG9yIG51bGwsIGluIHRoZSBjb21tb24gY2FzZVxuICAgKiBvZiBubyBlcnJvcnMpLiBfcmVzdWx0c18gaXMgYSBkaWN0aW9uYXJ5IG1hcHBpbmcgYFwiaG9zdG5hbWU6cG9ydFwiYCB0byBlaXRoZXJcbiAgICogYHRydWVgIChpZiB0aGUgb3BlcmF0aW9uIHdhcyBzdWNjZXNzZnVsKSwgb3IgYW4gZXJyb3IuXG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgZmx1c2goKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+PjtcbiAgZmx1c2goXG4gICAgY2FsbGJhY2s6IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgcmVzdWx0czogUmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IEVycm9yPlxuICAgICkgPT4gdm9pZFxuICApOiB2b2lkO1xuICBmbHVzaChcbiAgICBjYWxsYmFjaz86IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgcmVzdWx0czogUmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IEVycm9yPlxuICAgICkgPT4gdm9pZFxuICApIHtcbiAgICBpZiAoY2FsbGJhY2sgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHByb21pc2lmeSgoY2FsbGJhY2spID0+IHtcbiAgICAgICAgdGhpcy5mbHVzaChmdW5jdGlvbiAoZXJyLCByZXN1bHRzKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyLCByZXN1bHRzKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gVE9ETzogc3VwcG9ydCBleHBpcmF0aW9uXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MDgsIFwiXCIsIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTtcbiAgICBsZXQgY291bnQgPSB0aGlzLnNlcnZlcnMubGVuZ3RoO1xuICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IEVycm9yPiA9IHt9O1xuICAgIGxldCBsYXN0RXJyOiBFcnJvciB8IG51bGwgPSBudWxsO1xuXG4gICAgY29uc3QgaGFuZGxlRmx1c2ggPSBmdW5jdGlvbiAoc2VxOiBudW1iZXIsIHNlcnY6IFNlcnZlcikge1xuICAgICAgc2Vydi5vblJlc3BvbnNlKHNlcSwgZnVuY3Rpb24gKC8qIHJlc3BvbnNlICovKSB7XG4gICAgICAgIGNvdW50IC09IDE7XG4gICAgICAgIHJlc3VsdFtzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCldID0gdHJ1ZTtcbiAgICAgICAgaWYgKGNhbGxiYWNrICYmIGNvdW50ID09PSAwKSB7XG4gICAgICAgICAgY2FsbGJhY2sobGFzdEVyciwgcmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBzZXJ2Lm9uRXJyb3Ioc2VxLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGNvdW50IC09IDE7XG4gICAgICAgIGxhc3RFcnIgPSBlcnI7XG4gICAgICAgIHJlc3VsdFtzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCldID0gZXJyO1xuICAgICAgICBpZiAoY2FsbGJhY2sgJiYgY291bnQgPT09IDApIHtcbiAgICAgICAgICBjYWxsYmFjayhsYXN0RXJyLCByZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlcnYud3JpdGUocmVxdWVzdCk7XG4gICAgfTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYW5kbGVGbHVzaCh0aGlzLnNlcSwgdGhpcy5zZXJ2ZXJzW2ldKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU1RBVFNfV0lUSF9LRVlcbiAgICpcbiAgICogU2VuZHMgYSBtZW1jYWNoZSBzdGF0cyBjb21tYW5kIHdpdGggYSBrZXkgdG8gZWFjaCBjb25uZWN0ZWQgc2VydmVyLiBUaGVcbiAgICogY2FsbGJhY2sgaXMgaW52b2tlZCAqKk9OQ0UgUEVSIFNFUlZFUioqIGFuZCBoYXMgdGhlIHNpZ25hdHVyZTpcbiAgICpcbiAgICogICAgIGNhbGxiYWNrKGVyciwgc2VydmVyLCBzdGF0cylcbiAgICpcbiAgICogX3NlcnZlcl8gaXMgdGhlIGBcImhvc3RuYW1lOnBvcnRcImAgb2YgdGhlIHNlcnZlciwgYW5kIF9zdGF0c18gaXMgYSBkaWN0aW9uYXJ5XG4gICAqIG1hcHBpbmcgdGhlIHN0YXQgbmFtZSB0byB0aGUgdmFsdWUgb2YgdGhlIHN0YXRpc3RpYyBhcyBhIHN0cmluZy5cbiAgICogQHBhcmFtIGtleVxuICAgKiBAcGFyYW0gY2FsbGJhY2tcbiAgICovXG4gIHN0YXRzV2l0aEtleShcbiAgICBrZXk6IHN0cmluZyxcbiAgICBjYWxsYmFjaz86IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgc2VydmVyOiBzdHJpbmcsXG4gICAgICBzdGF0czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IG51bGxcbiAgICApID0+IHZvaWRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MTAsIGtleSwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpO1xuXG4gICAgY29uc3QgaGFuZGxlU3RhdHMgPSAoc2VxOiBudW1iZXIsIHNlcnY6IFNlcnZlcikgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgICBjb25zdCBoYW5kbGU6IE9uUmVzcG9uc2VDYWxsYmFjayA9IChyZXNwb25zZSkgPT4ge1xuICAgICAgICAvLyBlbmQgb2Ygc3RhdCByZXNwb25zZXNcbiAgICAgICAgaWYgKHJlc3BvbnNlLmhlYWRlci50b3RhbEJvZHlMZW5ndGggPT09IDApIHtcbiAgICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHNlcnYuaG9zdHBvcnRTdHJpbmcoKSwgcmVzdWx0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIHByb2Nlc3Mgc2luZ2xlIHN0YXQgbGluZSByZXNwb25zZVxuICAgICAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgICAgICByZXN1bHRbcmVzcG9uc2Uua2V5LnRvU3RyaW5nKCldID0gcmVzcG9uc2UudmFsLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLmhhbmRsZVJlc3BvbnNlRXJyb3IoXG4gICAgICAgICAgICAgIGBTVEFUUyAoJHtrZXl9KWAsXG4gICAgICAgICAgICAgIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICBjYWxsYmFjayhlcnJvciwgc2Vydi5ob3N0cG9ydFN0cmluZygpLCBudWxsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGhhbmRsZS5xdWlldCA9IHRydWU7XG5cbiAgICAgIHNlcnYub25SZXNwb25zZShzZXEsIGhhbmRsZSk7XG4gICAgICBzZXJ2Lm9uRXJyb3Ioc2VxLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgIGNhbGxiYWNrKGVyciwgc2Vydi5ob3N0cG9ydFN0cmluZygpLCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBzZXJ2LndyaXRlKHJlcXVlc3QpO1xuICAgIH07XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlU3RhdHModGhpcy5zZXEsIHRoaXMuc2VydmVyc1tpXSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNUQVRTXG4gICAqXG4gICAqIEZldGNoZXMgbWVtY2FjaGUgc3RhdHMgZnJvbSBlYWNoIGNvbm5lY3RlZCBzZXJ2ZXIuIFRoZSBjYWxsYmFjayBpcyBpbnZva2VkXG4gICAqICoqT05DRSBQRVIgU0VSVkVSKiogYW5kIGhhcyB0aGUgc2lnbmF0dXJlOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2soZXJyLCBzZXJ2ZXIsIHN0YXRzKVxuICAgKlxuICAgKiBfc2VydmVyXyBpcyB0aGUgYFwiaG9zdG5hbWU6cG9ydFwiYCBvZiB0aGUgc2VydmVyLCBhbmQgX3N0YXRzXyBpcyBhXG4gICAqIGRpY3Rpb25hcnkgbWFwcGluZyB0aGUgc3RhdCBuYW1lIHRvIHRoZSB2YWx1ZSBvZiB0aGUgc3RhdGlzdGljIGFzIGEgc3RyaW5nLlxuICAgKiBAcGFyYW0gY2FsbGJhY2tcbiAgICovXG4gIHN0YXRzKFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICBzZXJ2ZXI6IHN0cmluZyxcbiAgICAgIHN0YXRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbFxuICAgICkgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICB0aGlzLnN0YXRzV2l0aEtleShcIlwiLCBjYWxsYmFjayk7XG4gIH1cblxuICAvKipcbiAgICogUkVTRVRfU1RBVFNcbiAgICpcbiAgICogUmVzZXQgdGhlIHN0YXRpc3RpY3MgZWFjaCBzZXJ2ZXIgaXMga2VlcGluZyBiYWNrIHRvIHplcm8uIFRoaXMgZG9lc24ndCBjbGVhclxuICAgKiBzdGF0cyBzdWNoIGFzIGl0ZW0gY291bnQsIGJ1dCB0ZW1wb3Jhcnkgc3RhdHMgc3VjaCBhcyB0b3RhbCBudW1iZXIgb2ZcbiAgICogY29ubmVjdGlvbnMgb3ZlciB0aW1lLlxuICAgKlxuICAgKiBUaGUgY2FsbGJhY2sgaXMgaW52b2tlZCAqKk9OQ0UgUEVSIFNFUlZFUioqIGFuZCBoYXMgdGhlIHNpZ25hdHVyZTpcbiAgICpcbiAgICogICAgIGNhbGxiYWNrKGVyciwgc2VydmVyKVxuICAgKlxuICAgKiBfc2VydmVyXyBpcyB0aGUgYFwiaG9zdG5hbWU6cG9ydFwiYCBvZiB0aGUgc2VydmVyLlxuICAgKiBAcGFyYW0gY2FsbGJhY2tcbiAgICovXG4gIHJlc2V0U3RhdHMoXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHNlcnZlcjogc3RyaW5nLFxuICAgICAgc3RhdHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsXG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHNXaXRoS2V5KFwicmVzZXRcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgLyoqXG4gICAqIFFVSVRcbiAgICpcbiAgICogQ2xvc2VzIHRoZSBjb25uZWN0aW9uIHRvIGVhY2ggc2VydmVyLCBub3RpZnlpbmcgdGhlbSBvZiB0aGlzIGludGVudGlvbi4gTm90ZVxuICAgKiB0aGF0IHF1aXQgY2FuIHJhY2UgYWdhaW5zdCBhbHJlYWR5IG91dHN0YW5kaW5nIHJlcXVlc3RzIHdoZW4gdGhvc2UgcmVxdWVzdHNcbiAgICogZmFpbCBhbmQgYXJlIHJldHJpZWQsIGxlYWRpbmcgdG8gdGhlIHF1aXQgY29tbWFuZCB3aW5uaW5nIGFuZCBjbG9zaW5nIHRoZVxuICAgKiBjb25uZWN0aW9uIGJlZm9yZSB0aGUgcmV0cmllcyBjb21wbGV0ZS5cbiAgICovXG4gIHF1aXQoKSB7XG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgLy8gVE9ETzogTmljZXIgcGVyaGFwcyB0byBkbyBRVUlUUSAoMHgxNykgYnV0IG5lZWQgYSBuZXcgY2FsbGJhY2sgZm9yIHdoZW5cbiAgICAvLyB3cml0ZSBpcyBkb25lLlxuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDA3LCBcIlwiLCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7IC8vIFFVSVRcbiAgICBsZXQgc2VydjtcblxuICAgIGNvbnN0IGhhbmRsZVF1aXQgPSBmdW5jdGlvbiAoc2VxOiBudW1iZXIsIHNlcnY6IFNlcnZlcikge1xuICAgICAgc2Vydi5vblJlc3BvbnNlKHNlcSwgZnVuY3Rpb24gKC8qIHJlc3BvbnNlICovKSB7XG4gICAgICAgIHNlcnYuY2xvc2UoKTtcbiAgICAgIH0pO1xuICAgICAgc2Vydi5vbkVycm9yKHNlcSwgZnVuY3Rpb24gKC8qIGVyciAqLykge1xuICAgICAgICBzZXJ2LmNsb3NlKCk7XG4gICAgICB9KTtcbiAgICAgIHNlcnYud3JpdGUocmVxdWVzdCk7XG4gICAgfTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBzZXJ2ID0gdGhpcy5zZXJ2ZXJzW2ldO1xuICAgICAgaGFuZGxlUXVpdCh0aGlzLnNlcSwgc2Vydik7XG4gICAgfVxuICB9XG5cbiAgX3ZlcnNpb24oc2VydmVyOiBTZXJ2ZXIpOiBQcm9taXNlPHsgdmFsdWU6IFZhbHVlIHwgbnVsbCB9PiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuaW5jclNlcSgpO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgICBjb25zdGFudHMuT1BfVkVSU0lPTixcbiAgICAgICAgXCJcIixcbiAgICAgICAgXCJcIixcbiAgICAgICAgXCJcIixcbiAgICAgICAgdGhpcy5zZXFcbiAgICAgICk7XG4gICAgICB0aGlzLnBlcmZvcm1PblNlcnZlcihzZXJ2ZXIsIHJlcXVlc3QsIHRoaXMuc2VxLCAoZXJyLCByZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG5cbiAgICAgICAgc3dpdGNoIChyZXNwb25zZSEuaGVhZGVyLnN0YXR1cykge1xuICAgICAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgICAgIC8qIFRPRE86IHRoaXMgaXMgYnVnZ2VkLCB3ZSBzaG91bGQndCB1c2UgdGhlIGRlc2VyaWFsaXplciBoZXJlLCBzaW5jZSB2ZXJzaW9uIGFsd2F5cyByZXR1cm5zIGEgdmVyc2lvbiBzdHJpbmcuXG4gICAgICAgICAgICAgVGhlIGRlc2VyaWFsaXplciBzaG91bGQgb25seSBiZSB1c2VkIG9uIHVzZXIga2V5IGRhdGEuICovXG4gICAgICAgICAgICBjb25zdCBkZXNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuZGVzZXJpYWxpemUoXG4gICAgICAgICAgICAgIHJlc3BvbnNlIS5oZWFkZXIub3Bjb2RlLFxuICAgICAgICAgICAgICByZXNwb25zZSEudmFsLFxuICAgICAgICAgICAgICByZXNwb25zZSEuZXh0cmFzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuIHJlc29sdmUoeyB2YWx1ZTogZGVzZXJpYWxpemVkLnZhbHVlIH0pO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiVkVSU0lPTlwiLCByZXNwb25zZSEuaGVhZGVyLnN0YXR1cylcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVlc3QgdGhlIHNlcnZlciB2ZXJzaW9uIGZyb20gdGhlIFwiZmlyc3RcIiBzZXJ2ZXIgaW4gdGhlIGJhY2tlbmQgcG9vbC5cbiAgICogVGhlIHNlcnZlciByZXNwb25kcyB3aXRoIGEgcGFja2V0IGNvbnRhaW5pbmcgdGhlIHZlcnNpb24gc3RyaW5nIGluIHRoZSBib2R5IHdpdGggdGhlIGZvbGxvd2luZyBmb3JtYXQ6IFwieC55LnpcIlxuICAgKi9cbiAgdmVyc2lvbigpOiBQcm9taXNlPHsgdmFsdWU6IFZhbHVlIHwgbnVsbCB9PiB7XG4gICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcih0aGlzLnNlcnZlcktleXNbMF0pO1xuICAgIHJldHVybiB0aGlzLl92ZXJzaW9uKHNlcnZlcik7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBzZXJ2ZXIgdmVyc2lvbiBmcm9tIGFsbCB0aGUgc2VydmVyc1xuICAgKiBpbiB0aGUgYmFja2VuZCBwb29sLCBlcnJvcnMgaWYgYW55IG9uZSBvZiB0aGVtIGhhcyBhblxuICAgKiBlcnJvclxuICAgKi9cbiAgYXN5bmMgdmVyc2lvbkFsbCh0cmllZENhbGxiYWNrPzogKHJlc3BvbnNlOiBzdHJpbmcpID0+IHZvaWQsIHJlc3VsdENhbGxiYWNrPzogKHJlc3BvbnNlOiBzdHJpbmcpID0+IHZvaWQpOiBQcm9taXNlPHtcbiAgICB2YWx1ZXM6IFJlY29yZDxzdHJpbmcsIFZhbHVlIHwgbnVsbD47XG4gIH0+IHtcbiAgICBjb25zdCB2ZXJzaW9uT2JqZWN0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgdGhpcy5zZXJ2ZXJLZXlzLm1hcCgoc2VydmVyS2V5KSA9PiB7XG4gICAgICAgIGlmICh0cmllZENhbGxiYWNrICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0cmllZENhbGxiYWNrKHNlcnZlcktleSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXkpO1xuICAgICAgICByZXR1cm4gdGhpcy5fdmVyc2lvbihzZXJ2ZXIpLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdENhbGxiYWNrICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJlc3VsdENhbGxiYWNrKHNlcnZlcktleSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7IHNlcnZlcktleTogc2VydmVyS2V5LCB2YWx1ZTogcmVzcG9uc2UudmFsdWUgfTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgY29uc3QgdmFsdWVzID0gdmVyc2lvbk9iamVjdHMucmVkdWNlKChhY2N1bXVsYXRvciwgdmVyc2lvbk9iamVjdCkgPT4ge1xuICAgICAgYWNjdW11bGF0b3JbdmVyc2lvbk9iamVjdC5zZXJ2ZXJLZXldID0gdmVyc2lvbk9iamVjdC52YWx1ZTtcbiAgICAgIHJldHVybiBhY2N1bXVsYXRvcjtcbiAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBWYWx1ZSB8IG51bGw+KTtcbiAgICByZXR1cm4geyB2YWx1ZXM6IHZhbHVlcyB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyAoYWJydXB0bHkpIGNvbm5lY3Rpb25zIHRvIGFsbCB0aGUgc2VydmVycy5cbiAgICogQHNlZSB0aGlzLnF1aXRcbiAgICovXG4gIGNsb3NlKCkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGlzLnNlcnZlcnNbaV0uY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBhIGdlbmVyaWMgc2luZ2xlIHJlc3BvbnNlIG9wZXJhdGlvbiAoZ2V0LCBzZXQgZXRjKSBvbiBvbmUgc2VydmVyXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgdGhlIGtleSB0byBoYXNoIHRvIGdldCBhIHNlcnZlciBmcm9tIHRoZSBwb29sXG4gICAqIEBwYXJhbSB7YnVmZmVyfSByZXF1ZXN0IGEgYnVmZmVyIGNvbnRhaW5pbmcgdGhlIHJlcXVlc3RcbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlcSB0aGUgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSBvcGVyYXRpb24uIEl0IGlzIHVzZWQgdG8gcGluIHRoZSBjYWxsYmFja3NcbiAgICAgICAgICAgICAgICAgICAgICAgICB0byBhIHNwZWNpZmljIG9wZXJhdGlvbiBhbmQgc2hvdWxkIG5ldmVyIGNoYW5nZSBkdXJpbmcgYSBgcGVyZm9ybWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyP30gcmV0cmllcyBudW1iZXIgb2YgdGltZXMgdG8gcmV0cnkgcmVxdWVzdCBvbiBmYWlsdXJlXG4gICAqL1xuICBwZXJmb3JtKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHJlcXVlc3Q6IEJ1ZmZlcixcbiAgICBzZXE6IG51bWJlcixcbiAgICByZXRyaWVzPzogbnVtYmVyXG4gICk6IFByb21pc2U8TWVzc2FnZT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBzZXJ2ZXJLZXkgPSB0aGlzLmxvb2t1cEtleVRvU2VydmVyS2V5KGtleSk7XG4gICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG5cbiAgICAgIGlmICghc2VydmVyKSB7XG4gICAgICAgIHJldHVybiByZWplY3QobmV3IEVycm9yKFwiTm8gc2VydmVycyBhdmFpbGFibGVcIikpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnBlcmZvcm1PblNlcnZlcihcbiAgICAgICAgc2VydmVyLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICBzZXEsXG4gICAgICAgIChlcnJvciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlISk7XG4gICAgICAgIH0sXG4gICAgICAgIHJldHJpZXNcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwZXJmb3JtT25TZXJ2ZXIoXG4gICAgc2VydmVyOiBTZXJ2ZXIsXG4gICAgcmVxdWVzdDogQnVmZmVyLFxuICAgIHNlcTogbnVtYmVyLFxuICAgIGNhbGxiYWNrOiBSZXNwb25zZU9yRXJyb3JDYWxsYmFjayxcbiAgICByZXRyaWVzOiBudW1iZXIgPSAwXG4gICkge1xuICAgIGNvbnN0IF90aGlzID0gdGhpcztcblxuICAgIHJldHJpZXMgPSByZXRyaWVzIHx8IHRoaXMub3B0aW9ucy5yZXRyaWVzO1xuICAgIGNvbnN0IG9yaWdSZXRyaWVzID0gdGhpcy5vcHRpb25zLnJldHJpZXM7XG4gICAgY29uc3QgbG9nZ2VyID0gdGhpcy5vcHRpb25zLmxvZ2dlcjtcbiAgICBjb25zdCByZXRyeV9kZWxheSA9IHRoaXMub3B0aW9ucy5yZXRyeV9kZWxheTtcblxuICAgIGNvbnN0IHJlc3BvbnNlSGFuZGxlcjogT25SZXNwb25zZUNhbGxiYWNrID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzcG9uc2UpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCBlcnJvckhhbmRsZXI6IE9uRXJyb3JDYWxsYmFjayA9IGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgaWYgKC0tcmV0cmllcyA+IDApIHtcbiAgICAgICAgLy8gV2FpdCBmb3IgcmV0cnlfZGVsYXlcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgX3RoaXMucGVyZm9ybU9uU2VydmVyKHNlcnZlciwgcmVxdWVzdCwgc2VxLCBjYWxsYmFjaywgcmV0cmllcyk7XG4gICAgICAgIH0sIDEwMDAgKiByZXRyeV9kZWxheSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIubG9nKFxuICAgICAgICAgIFwiTWVtSlM6IFNlcnZlciA8XCIgK1xuICAgICAgICAgICAgc2VydmVyLmhvc3Rwb3J0U3RyaW5nKCkgK1xuICAgICAgICAgICAgXCI+IGZhaWxlZCBhZnRlciAoXCIgK1xuICAgICAgICAgICAgb3JpZ1JldHJpZXMgK1xuICAgICAgICAgICAgXCIpIHJldHJpZXMgd2l0aCBlcnJvciAtIFwiICtcbiAgICAgICAgICAgIGVycm9yLm1lc3NhZ2VcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHNlcnZlci5vblJlc3BvbnNlKHNlcSwgcmVzcG9uc2VIYW5kbGVyKTtcbiAgICBzZXJ2ZXIub25FcnJvcihzZXEsIGVycm9ySGFuZGxlcik7XG4gICAgc2VydmVyLndyaXRlKHJlcXVlc3QpO1xuICB9XG5cbiAgLy8gSW5jcmVtZW50IHRoZSBzZXEgdmFsdWVcbiAgaW5jclNlcSgpIHtcbiAgICB0aGlzLnNlcSsrO1xuXG4gICAgLy8gV3JhcCBgdGhpcy5zZXFgIHRvIDMyLWJpdHMgc2luY2UgdGhlIGZpZWxkIHdlIGZpdCBpdCBpbnRvIGlzIG9ubHkgMzItYml0cy5cbiAgICB0aGlzLnNlcSAmPSAweGZmZmZmZmZmO1xuXG4gICAgcmV0dXJuIHRoaXMuc2VxXG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUFuZExvZ0Vycm9yKFxuICAgIGNvbW1hbmROYW1lOiBzdHJpbmcsXG4gICAgcmVzcG9uc2VTdGF0dXM6IFJlc3BvbnNlU3RhdHVzIHwgdW5kZWZpbmVkXG4gICk6IEVycm9yIHtcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgTWVtSlMgJHtjb21tYW5kTmFtZX06ICR7Y29uc3RhbnRzLnJlc3BvbnNlU3RhdHVzVG9TdHJpbmcoXG4gICAgICByZXNwb25zZVN0YXR1c1xuICAgICl9YDtcbiAgICB0aGlzLm9wdGlvbnMubG9nZ2VyLmxvZyhlcnJvck1lc3NhZ2UpO1xuICAgIHJldHVybiBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgYW4gZXJyb3IgdG8gdGhlIGxvZ2dlciwgdGhlbiByZXR1cm4gdGhlIGVycm9yLlxuICAgKiBJZiBhIGNhbGxiYWNrIGlzIGdpdmVuLCBjYWxsIGl0IHdpdGggY2FsbGJhY2soZXJyb3IsIG51bGwpLlxuICAgKi9cbiAgcHJpdmF0ZSBoYW5kbGVSZXNwb25zZUVycm9yKFxuICAgIGNvbW1hbmROYW1lOiBzdHJpbmcsXG4gICAgcmVzcG9uc2VTdGF0dXM6IFJlc3BvbnNlU3RhdHVzIHwgdW5kZWZpbmVkLFxuICAgIGNhbGxiYWNrOiB1bmRlZmluZWQgfCAoKGVycm9yOiBFcnJvciB8IG51bGwsIG90aGVyOiBudWxsKSA9PiB2b2lkKVxuICApOiBFcnJvciB7XG4gICAgY29uc3QgZXJyb3IgPSB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKGNvbW1hbmROYW1lLCByZXNwb25zZVN0YXR1cyk7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhlcnJvciwgbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiBlcnJvcjtcbiAgfVxufVxuXG5leHBvcnQgeyBDbGllbnQsIFNlcnZlciwgVXRpbHMsIEhlYWRlciB9O1xuIl19