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
                        else if (response.header.opcode === constants.OP_GETK ||
                            response.header.opcode === constants.OP_GETKQ) {
                            const deserialized = this.serializer.deserialize(response.header.opcode, response.val, response.extras);
                            const key = response.key.toString();
                            if (key.length === 0) {
                                return reject(new Error("Recieved empty key in getMulti: " +
                                    JSON.stringify(response)));
                            }
                            responseMap[key] = { ...deserialized, cas: response.header.cas };
                        }
                        else {
                            return reject(new Error("Recieved response in getMulti for unknown opcode: " +
                                JSON.stringify(response)));
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
    async versionAll(callbacks) {
        const versionObjects = await Promise.all(this.serverKeys.map((serverKey) => {
            var _a;
            const server = this.serverKeyToServer(serverKey);
            (_a = callbacks === null || callbacks === void 0 ? void 0 : callbacks.beforePing) === null || _a === void 0 ? void 0 : _a.call(callbacks, serverKey);
            return this._version(server).then((response) => {
                var _a;
                (_a = callbacks === null || callbacks === void 0 ? void 0 : callbacks.afterPing) === null || _a === void 0 ? void 0 : _a.call(callbacks, serverKey);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVtanMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvbWVtanMvbWVtanMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLHdCQUF3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUV4QixxQ0FLa0I7QUF3aUNELHVGQTFpQ2YsZUFBTSxPQTBpQ2U7QUF2aUN2Qix1REFBK0Q7QUFDL0QsbUNBU2lCO0FBQ2pCLHVEQUF5QztBQUN6QywyQ0FBNkM7QUFDN0MsK0NBQWlDO0FBMGhDUixzQkFBSztBQXpoQzlCLGlEQUFtQztBQXloQ0gsd0JBQU07QUF2aEN0QyxTQUFTLDhCQUE4QixDQUNyQyxPQUFpQixFQUNqQixHQUFXO0lBRVgsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUM3QixNQUFNLEtBQUssR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hCLENBQUM7QUFFRCwrQ0FBK0M7QUFDL0MsU0FBUyxTQUFTLENBQ2hCLE9BQTBFO0lBRTFFLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxPQUFPLEVBQUUsTUFBTTtRQUMxQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUUsTUFBTTtZQUMzQixHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBeURELE1BQU0sTUFBTTtJQVFWLDRFQUE0RTtJQUM1RSxtQ0FBbUM7SUFDbkMsWUFBWSxPQUFpQixFQUFFLE9BQTBDO1FBQ3ZFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElB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QixFQUNuQixjQUEwQztRQUUxQyxNQUFNLFlBQVksR0FBRyxTQUFTLFdBQVcsS0FBSyxTQUFTLENBQUMsc0JBQXNCLENBQzVFLGNBQWMsQ0FDZixFQUFFLENBQUM7UUFDSixJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdEMsT0FBTyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssbUJBQW1CLENBQ3pCLFdBQW1CLEVBQ25CLGNBQTBDLEVBQzFDLFFBQWtFO1FBRWxFLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDbEUsSUFBSSxRQUFRLEVBQUU7WUFDWixRQUFRLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO1NBQ3ZCO1FBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0NBQ0Y7QUFFUSx3QkFBTSIsInNvdXJjZXNDb250ZW50IjpbIi8vIE1lbVRTIE1lbWNhY2hlIENsaWVudFxuXG5pbXBvcnQge1xuICBPbkVycm9yQ2FsbGJhY2ssXG4gIE9uUmVzcG9uc2VDYWxsYmFjayxcbiAgU2VydmVyLFxuICBTZXJ2ZXJPcHRpb25zLFxufSBmcm9tIFwiLi9zZXJ2ZXJcIjtcbmltcG9ydCB7IG5vb3BTZXJpYWxpemVyLCBTZXJpYWxpemVyIH0gZnJvbSBcIi4vbm9vcC1zZXJpYWxpemVyXCI7XG5pbXBvcnQge1xuICBtYWtlUmVxdWVzdEJ1ZmZlcixcbiAgY29weUludG9SZXF1ZXN0QnVmZmVyLFxuICBtZXJnZSxcbiAgbWFrZUV4cGlyYXRpb24sXG4gIG1ha2VBbW91bnRJbml0aWFsQW5kRXhwaXJhdGlvbixcbiAgaGFzaENvZGUsXG4gIE1heWJlQnVmZmVyLFxuICBNZXNzYWdlLFxufSBmcm9tIFwiLi91dGlsc1wiO1xuaW1wb3J0ICogYXMgY29uc3RhbnRzIGZyb20gXCIuL2NvbnN0YW50c1wiO1xuaW1wb3J0IHsgUmVzcG9uc2VTdGF0dXMgfSBmcm9tIFwiLi9jb25zdGFudHNcIjtcbmltcG9ydCAqIGFzIFV0aWxzIGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgKiBhcyBIZWFkZXIgZnJvbSBcIi4vaGVhZGVyXCI7XG5cbmZ1bmN0aW9uIGRlZmF1bHRLZXlUb1NlcnZlckhhc2hGdW5jdGlvbihcbiAgc2VydmVyczogc3RyaW5nW10sXG4gIGtleTogc3RyaW5nXG4pOiBzdHJpbmcge1xuICBjb25zdCB0b3RhbCA9IHNlcnZlcnMubGVuZ3RoO1xuICBjb25zdCBpbmRleCA9IHRvdGFsID4gMSA/IGhhc2hDb2RlKGtleSkgJSB0b3RhbCA6IDA7XG4gIHJldHVybiBzZXJ2ZXJzW2luZGV4XTtcbn1cblxuLy8gY29udmVydHMgYSBjYWxsIGludG8gYSBwcm9taXNlLXJldHVybmluZyBvbmVcbmZ1bmN0aW9uIHByb21pc2lmeTxSZXN1bHQ+KFxuICBjb21tYW5kOiAoY2FsbGJhY2s6IChlcnJvcjogRXJyb3IgfCBudWxsLCByZXN1bHQ6IFJlc3VsdCkgPT4gdm9pZCkgPT4gdm9pZFxuKTogUHJvbWlzZTxSZXN1bHQ+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICBjb21tYW5kKGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICAgICAgZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKHJlc3VsdCk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG50eXBlIFJlc3BvbnNlT3JFcnJvckNhbGxiYWNrID0gKFxuICBlcnJvcjogRXJyb3IgfCBudWxsLFxuICByZXNwb25zZTogTWVzc2FnZSB8IG51bGxcbikgPT4gdm9pZDtcblxuaW50ZXJmYWNlIEJhc2VDbGllbnRPcHRpb25zIHtcbiAgcmV0cmllczogbnVtYmVyO1xuICByZXRyeV9kZWxheTogbnVtYmVyO1xuICBleHBpcmVzOiBudW1iZXI7XG4gIGxvZ2dlcjogeyBsb2c6IHR5cGVvZiBjb25zb2xlLmxvZyB9O1xuICBrZXlUb1NlcnZlckhhc2hGdW5jdGlvbjogdHlwZW9mIGRlZmF1bHRLZXlUb1NlcnZlckhhc2hGdW5jdGlvbjtcbn1cblxuaW50ZXJmYWNlIFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+IHtcbiAgc2VyaWFsaXplcjogU2VyaWFsaXplcjxWYWx1ZSwgRXh0cmFzPjtcbn1cblxuLyoqXG4gKiBUaGUgY2xpZW50IGhhcyBwYXJ0aWFsIHN1cHBvcnQgZm9yIHNlcmlhbGl6aW5nIGFuZCBkZXNlcmlhbGl6aW5nIHZhbHVlcyBmcm9tIHRoZVxuICogQnVmZmVyIGJ5dGUgc3RyaW5ncyB3ZSByZWNlaXZlIGZyb20gdGhlIHdpcmUuIFRoZSBkZWZhdWx0IHNlcmlhbGl6ZXIgaXMgZm9yIE1heWJlQnVmZmVyLlxuICpcbiAqIElmIFZhbHVlIGFuZCBFeHRyYXMgYXJlIG9mIHR5cGUgQnVmZmVyLCB0aGVuIHJldHVybiB0eXBlIFdoZW5CdWZmZXIuIE90aGVyd2lzZSxcbiAqIHJldHVybiB0eXBlIE5vdEJ1ZmZlci5cbiAqL1xudHlwZSBJZkJ1ZmZlcjxWYWx1ZSwgRXh0cmFzLCBXaGVuVmFsdWVBbmRFeHRyYXNBcmVCdWZmZXJzLCBOb3RCdWZmZXI+ID1cbiAgVmFsdWUgZXh0ZW5kcyBCdWZmZXJcbiAgICA/IEV4dHJhcyBleHRlbmRzIEJ1ZmZlclxuICAgICAgPyBXaGVuVmFsdWVBbmRFeHRyYXNBcmVCdWZmZXJzXG4gICAgICA6IE5vdEJ1ZmZlclxuICAgIDogTm90QnVmZmVyO1xuXG5leHBvcnQgdHlwZSBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz4gPSBQYXJ0aWFsPEJhc2VDbGllbnRPcHRpb25zPiAmXG4gIElmQnVmZmVyPFxuICAgIFZhbHVlLFxuICAgIEV4dHJhcyxcbiAgICBQYXJ0aWFsPFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+PixcbiAgICBTZXJpYWxpemVyUHJvcDxWYWx1ZSwgRXh0cmFzPlxuICA+O1xuXG5leHBvcnQgdHlwZSBDQVNUb2tlbiA9IEJ1ZmZlcjtcblxuZXhwb3J0IGludGVyZmFjZSBHZXRSZXN1bHQ8VmFsdWUgPSBNYXliZUJ1ZmZlciwgRXh0cmFzID0gTWF5YmVCdWZmZXI+IHtcbiAgdmFsdWU6IFZhbHVlO1xuICBleHRyYXM6IEV4dHJhcztcbiAgY2FzOiBDQVNUb2tlbiB8IHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IHR5cGUgR2V0TXVsdGlSZXN1bHQ8XG4gIEtleXMgZXh0ZW5kcyBzdHJpbmcgPSBzdHJpbmcsXG4gIFZhbHVlID0gTWF5YmVCdWZmZXIsXG4gIEV4dHJhcyA9IE1heWJlQnVmZmVyXG4+ID0ge1xuICBbSyBpbiBLZXlzXT86IEdldFJlc3VsdDxWYWx1ZSwgRXh0cmFzPjtcbn07XG5cbmNsYXNzIENsaWVudDxWYWx1ZSA9IE1heWJlQnVmZmVyLCBFeHRyYXMgPSBNYXliZUJ1ZmZlcj4ge1xuICBzZXJ2ZXJzOiBTZXJ2ZXJbXTtcbiAgc2VxOiBudW1iZXI7XG4gIG9wdGlvbnM6IEJhc2VDbGllbnRPcHRpb25zICYgUGFydGlhbDxTZXJpYWxpemVyUHJvcDxWYWx1ZSwgRXh0cmFzPj47XG4gIHNlcmlhbGl6ZXI6IFNlcmlhbGl6ZXI8VmFsdWUsIEV4dHJhcz47XG4gIHNlcnZlck1hcDogeyBbaG9zdHBvcnQ6IHN0cmluZ106IFNlcnZlciB9O1xuICBzZXJ2ZXJLZXlzOiBzdHJpbmdbXTtcblxuICAvLyBDbGllbnQgaW5pdGlhbGl6ZXIgdGFrZXMgYSBsaXN0IG9mIGBTZXJ2ZXJgcyBhbmQgYW4gYG9wdGlvbnNgIGRpY3Rpb25hcnkuXG4gIC8vIFNlZSBgQ2xpZW50LmNyZWF0ZWAgZm9yIGRldGFpbHMuXG4gIGNvbnN0cnVjdG9yKHNlcnZlcnM6IFNlcnZlcltdLCBvcHRpb25zOiBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz4pIHtcbiAgICB0aGlzLnNlcnZlcnMgPSBzZXJ2ZXJzO1xuICAgIHRoaXMuc2VxID0gMDtcbiAgICB0aGlzLm9wdGlvbnMgPSBtZXJnZShvcHRpb25zIHx8IHt9LCB7XG4gICAgICByZXRyaWVzOiAyLFxuICAgICAgcmV0cnlfZGVsYXk6IDAuMixcbiAgICAgIGV4cGlyZXM6IDAsXG4gICAgICBsb2dnZXI6IGNvbnNvbGUsXG4gICAgICBrZXlUb1NlcnZlckhhc2hGdW5jdGlvbjogZGVmYXVsdEtleVRvU2VydmVySGFzaEZ1bmN0aW9uLFxuICAgIH0pO1xuXG4gICAgdGhpcy5zZXJpYWxpemVyID0gdGhpcy5vcHRpb25zLnNlcmlhbGl6ZXIgfHwgKG5vb3BTZXJpYWxpemVyIGFzIGFueSk7XG5cbiAgICAvLyBTdG9yZSBhIG1hcHBpbmcgZnJvbSBob3N0cG9ydCAtPiBzZXJ2ZXIgc28gd2UgY2FuIHF1aWNrbHkgZ2V0IGEgc2VydmVyIG9iamVjdCBmcm9tIHRoZSBzZXJ2ZXJLZXkgcmV0dXJuZWQgYnkgdGhlIGhhc2hpbmcgZnVuY3Rpb25cbiAgICBjb25zdCBzZXJ2ZXJNYXA6IHsgW2hvc3Rwb3J0OiBzdHJpbmddOiBTZXJ2ZXIgfSA9IHt9O1xuICAgIHRoaXMuc2VydmVycy5mb3JFYWNoKGZ1bmN0aW9uIChzZXJ2ZXIpIHtcbiAgICAgIHNlcnZlck1hcFtzZXJ2ZXIuaG9zdHBvcnRTdHJpbmcoKV0gPSBzZXJ2ZXI7XG4gICAgfSk7XG4gICAgdGhpcy5zZXJ2ZXJNYXAgPSBzZXJ2ZXJNYXA7XG5cbiAgICAvLyBzdG9yZSBhIGxpc3Qgb2YgYWxsIG91ciBzZXJ2ZXJLZXlzIHNvIHdlIGRvbid0IG5lZWQgdG8gY29uc3RhbnRseSByZWFsbG9jYXRlIHRoaXMgYXJyYXlcbiAgICB0aGlzLnNlcnZlcktleXMgPSBPYmplY3Qua2V5cyh0aGlzLnNlcnZlck1hcCk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBjbGllbnQgZ2l2ZW4gYW4gb3B0aW9uYWwgY29uZmlnIHN0cmluZyBhbmQgb3B0aW9uYWwgaGFzaCBvZlxuICAgKiBvcHRpb25zLiBUaGUgY29uZmlnIHN0cmluZyBzaG91bGQgYmUgb2YgdGhlIGZvcm06XG4gICAqXG4gICAqICAgICBcIlt1c2VyOnBhc3NAXXNlcnZlcjFbOjExMjExXSxbdXNlcjpwYXNzQF1zZXJ2ZXIyWzoxMTIxMV0sLi4uXCJcbiAgICpcbiAgICogSWYgdGhlIGFyZ3VtZW50IGlzIG5vdCBnaXZlbiwgZmFsbGJhY2sgb24gdGhlIGBNRU1DQUNISUVSX1NFUlZFUlNgIGVudmlyb25tZW50XG4gICAqIHZhcmlhYmxlLCBgTUVNQ0FDSEVfU0VSVkVSU2AgZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgYFwibG9jYWxob3N0OjExMjExXCJgLlxuICAgKlxuICAgKiBUaGUgb3B0aW9ucyBoYXNoIG1heSBjb250YWluIHRoZSBvcHRpb25zOlxuICAgKlxuICAgKiAqIGByZXRyaWVzYCAtIHRoZSBudW1iZXIgb2YgdGltZXMgdG8gcmV0cnkgYW4gb3BlcmF0aW9uIGluIGxpZXUgb2YgZmFpbHVyZXNcbiAgICogKGRlZmF1bHQgMilcbiAgICogKiBgZXhwaXJlc2AgLSB0aGUgZGVmYXVsdCBleHBpcmF0aW9uIGluIHNlY29uZHMgdG8gdXNlIChkZWZhdWx0IDAgLSBuZXZlclxuICAgKiBleHBpcmUpLiBJZiBgZXhwaXJlc2AgaXMgZ3JlYXRlciB0aGFuIDMwIGRheXMgKDYwIHggNjAgeCAyNCB4IDMwKSwgaXQgaXNcbiAgICogdHJlYXRlZCBhcyBhIFVOSVggdGltZSAobnVtYmVyIG9mIHNlY29uZHMgc2luY2UgSmFudWFyeSAxLCAxOTcwKS5cbiAgICogKiBgbG9nZ2VyYCAtIGEgbG9nZ2VyIG9iamVjdCB0aGF0IHJlc3BvbmRzIHRvIGBsb2coc3RyaW5nKWAgbWV0aG9kIGNhbGxzLlxuICAgKlxuICAgKiAgIH5+fn5cbiAgICogICAgIGxvZyhtc2cxWywgbXNnMlssIG1zZzNbLi4uXV1dKVxuICAgKiAgIH5+fn5cbiAgICpcbiAgICogICBEZWZhdWx0cyB0byBgY29uc29sZWAuXG4gICAqICogYHNlcmlhbGl6ZXJgIC0gdGhlIG9iamVjdCB3aGljaCB3aWxsIChkZSlzZXJpYWxpemUgdGhlIGRhdGEuIEl0IG5lZWRzXG4gICAqICAgdHdvIHB1YmxpYyBtZXRob2RzOiBzZXJpYWxpemUgYW5kIGRlc2VyaWFsaXplLiBJdCBkZWZhdWx0cyB0byB0aGVcbiAgICogICBub29wU2VyaWFsaXplcjpcbiAgICpcbiAgICogICB+fn5+XG4gICAqICAgY29uc3Qgbm9vcFNlcmlhbGl6ZXIgPSB7XG4gICAqICAgICBzZXJpYWxpemU6IGZ1bmN0aW9uIChvcGNvZGUsIHZhbHVlLCBleHRyYXMpIHtcbiAgICogICAgICAgcmV0dXJuIHsgdmFsdWU6IHZhbHVlLCBleHRyYXM6IGV4dHJhcyB9O1xuICAgKiAgICAgfSxcbiAgICogICAgIGRlc2VyaWFsaXplOiBmdW5jdGlvbiAob3Bjb2RlLCB2YWx1ZSwgZXh0cmFzKSB7XG4gICAqICAgICAgIHJldHVybiB7IHZhbHVlOiB2YWx1ZSwgZXh0cmFzOiBleHRyYXMgfTtcbiAgICogICAgIH1cbiAgICogICB9O1xuICAgKiAgIH5+fn5cbiAgICpcbiAgICogT3Igb3B0aW9ucyBmb3IgdGhlIHNlcnZlcnMgaW5jbHVkaW5nOlxuICAgKiAqIGB1c2VybmFtZWAgYW5kIGBwYXNzd29yZGAgZm9yIGZhbGxiYWNrIFNBU0wgYXV0aGVudGljYXRpb24gY3JlZGVudGlhbHMuXG4gICAqICogYHRpbWVvdXRgIGluIHNlY29uZHMgdG8gZGV0ZXJtaW5lIGZhaWx1cmUgZm9yIG9wZXJhdGlvbnMuIERlZmF1bHQgaXMgMC41XG4gICAqICAgICAgICAgICAgIHNlY29uZHMuXG4gICAqICogJ2Nvbm50aW1lb3V0JyBpbiBzZWNvbmRzIHRvIGNvbm5lY3Rpb24gZmFpbHVyZS4gRGVmYXVsdCBpcyB0d2ljZSB0aGUgdmFsdWVcbiAgICogICAgICAgICAgICAgICAgIG9mIGB0aW1lb3V0YC5cbiAgICogKiBga2VlcEFsaXZlYCB3aGV0aGVyIHRvIGVuYWJsZSBrZWVwLWFsaXZlIGZ1bmN0aW9uYWxpdHkuIERlZmF1bHRzIHRvIGZhbHNlLlxuICAgKiAqIGBrZWVwQWxpdmVEZWxheWAgaW4gc2Vjb25kcyB0byB0aGUgaW5pdGlhbCBkZWxheSBiZWZvcmUgdGhlIGZpcnN0IGtlZXBhbGl2ZVxuICAgKiAgICAgICAgICAgICAgICAgICAgcHJvYmUgaXMgc2VudCBvbiBhbiBpZGxlIHNvY2tldC4gRGVmYXVsdHMgaXMgMzAgc2Vjb25kcy5cbiAgICogKiBga2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb25gIGEgZnVuY3Rpb24gdG8gbWFwIGtleXMgdG8gc2VydmVycywgd2l0aCB0aGUgc2lnbmF0dXJlXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIChzZXJ2ZXJLZXlzOiBzdHJpbmdbXSwga2V5OiBzdHJpbmcpOiBzdHJpbmdcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgTk9URTogaWYgeW91IG5lZWQgdG8gZG8gc29tZSBleHBlbnNpdmUgaW5pdGlhbGl6YXRpb24sICpwbGVhc2UqIGRvIGl0IGxhemlseSB0aGUgZmlyc3QgdGltZSB5b3UgdGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgd2l0aCBhbiBhcnJheSBvZiBzZXJ2ZXJLZXlzLCBub3Qgb24gZXZlcnkgY2FsbFxuICAgKi9cbiAgc3RhdGljIGNyZWF0ZTxWYWx1ZSwgRXh0cmFzPihcbiAgICBzZXJ2ZXJzU3RyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgb3B0aW9uczogSWZCdWZmZXI8XG4gICAgICBWYWx1ZSxcbiAgICAgIEV4dHJhcyxcbiAgICAgIHVuZGVmaW5lZCB8IChQYXJ0aWFsPFNlcnZlck9wdGlvbnM+ICYgR2l2ZW5DbGllbnRPcHRpb25zPFZhbHVlLCBFeHRyYXM+KSxcbiAgICAgIFBhcnRpYWw8U2VydmVyT3B0aW9ucz4gJiBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz5cbiAgICA+XG4gICk6IENsaWVudDxWYWx1ZSwgRXh0cmFzPiB7XG4gICAgc2VydmVyc1N0ciA9XG4gICAgICBzZXJ2ZXJzU3RyIHx8XG4gICAgICBwcm9jZXNzLmVudi5NRU1DQUNISUVSX1NFUlZFUlMgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hFX1NFUlZFUlMgfHxcbiAgICAgIFwibG9jYWxob3N0OjExMjExXCI7XG4gICAgY29uc3Qgc2VydmVyVXJpcyA9IHNlcnZlcnNTdHIuc3BsaXQoXCIsXCIpO1xuICAgIGNvbnN0IHNlcnZlcnMgPSBzZXJ2ZXJVcmlzLm1hcChmdW5jdGlvbiAodXJpKSB7XG4gICAgICBjb25zdCB1cmlQYXJ0cyA9IHVyaS5zcGxpdChcIkBcIik7XG4gICAgICBjb25zdCBob3N0UG9ydCA9IHVyaVBhcnRzW3VyaVBhcnRzLmxlbmd0aCAtIDFdLnNwbGl0KFwiOlwiKTtcbiAgICAgIGNvbnN0IHVzZXJQYXNzID0gKHVyaVBhcnRzW3VyaVBhcnRzLmxlbmd0aCAtIDJdIHx8IFwiXCIpLnNwbGl0KFwiOlwiKTtcbiAgICAgIHJldHVybiBuZXcgU2VydmVyKFxuICAgICAgICBob3N0UG9ydFswXSxcbiAgICAgICAgcGFyc2VJbnQoaG9zdFBvcnRbMV0gfHwgXCIxMTIxMVwiLCAxMCksXG4gICAgICAgIHVzZXJQYXNzWzBdLFxuICAgICAgICB1c2VyUGFzc1sxXSxcbiAgICAgICAgb3B0aW9uc1xuICAgICAgKTtcbiAgICB9KTtcbiAgICByZXR1cm4gbmV3IENsaWVudChzZXJ2ZXJzLCBvcHRpb25zIGFzIGFueSk7XG4gIH1cblxuICAvKipcbiAgICogR2l2ZW4gYSBzZXJ2ZXJLZXkgZnJvbWxvb2t1cEtleVRvU2VydmVyS2V5LCByZXR1cm4gdGhlIGNvcnJlc3BvbmRpbmcgU2VydmVyIGluc3RhbmNlXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gc2VydmVyS2V5XG4gICAqIEByZXR1cm5zIHtTZXJ2ZXJ9XG4gICAqL1xuICBzZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXk6IHN0cmluZyk6IFNlcnZlciB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmVyTWFwW3NlcnZlcktleV07XG4gIH1cblxuICAvKipcbiAgICogR2l2ZW4gYSBrZXkgdG8gbG9vayB1cCBpbiBtZW1jYWNoZSwgcmV0dXJuIGEgc2VydmVyS2V5IChiYXNlZCBvbiBzb21lXG4gICAqIGhhc2hpbmcgZnVuY3Rpb24pIHdoaWNoIGNhbiBiZSB1c2VkIHRvIGluZGV4IHRoaXMuc2VydmVyTWFwXG4gICAqL1xuICBsb29rdXBLZXlUb1NlcnZlcktleShrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5rZXlUb1NlcnZlckhhc2hGdW5jdGlvbih0aGlzLnNlcnZlcktleXMsIGtleSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSB2YWx1ZSBhdCB0aGUgZ2l2ZW4ga2V5IGluIG1lbWNhY2hlLlxuICAgKi9cbiAgYXN5bmMgZ2V0KGtleTogc3RyaW5nKTogUHJvbWlzZTxHZXRSZXN1bHQ8VmFsdWUsIEV4dHJhcz4gfCBudWxsPiB7XG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKGNvbnN0YW50cy5PUF9HRVQsIGtleSwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICBjb25zdCBkZXNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuZGVzZXJpYWxpemUoXG4gICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLm9wY29kZSxcbiAgICAgICAgICByZXNwb25zZS52YWwsXG4gICAgICAgICAgcmVzcG9uc2UuZXh0cmFzXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiB7IC4uLmRlc2VyaWFsaXplZCwgY2FzOiByZXNwb25zZS5oZWFkZXIuY2FzIH07XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkdFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKiogQnVpbGQgYSBwaXBlbGluZWQgZ2V0IG11bHRpIHJlcXVlc3QgYnkgc2VuZGluZyBvbmUgR0VUS1EgZm9yIGVhY2gga2V5IChxdWlldCwgbWVhbmluZyBpdCB3b24ndCByZXNwb25kIGlmIHRoZSB2YWx1ZSBpcyBtaXNzaW5nKSBmb2xsb3dlZCBieSBhIG5vLW9wIHRvIGZvcmNlIGEgcmVzcG9uc2UgKGFuZCB0byBnaXZlIHVzIGEgc2VudGluZWwgcmVzcG9uc2UgdGhhdCB0aGUgcGlwZWxpbmUgaXMgZG9uZSlcbiAgICpcbiAgICogY2YgaHR0cHM6Ly9naXRodWIuY29tL2NvdWNoYmFzZS9tZW1jYWNoZWQvYmxvYi9tYXN0ZXIvZG9jcy9CaW5hcnlQcm90b2NvbC5tZCMweDBkLWdldGtxLWdldC13aXRoLWtleS1xdWlldGx5XG4gICAqL1xuICBfYnVpbGRHZXRNdWx0aVJlcXVlc3Qoa2V5czogc3RyaW5nW10sIHNlcTogbnVtYmVyKTogQnVmZmVyIHtcbiAgICAvLyBzdGFydCBhdCAyNCBmb3IgdGhlIG5vLW9wIGNvbW1hbmQgYXQgdGhlIGVuZFxuICAgIGxldCByZXF1ZXN0U2l6ZSA9IDI0O1xuICAgIGZvciAoY29uc3Qga2V5SWR4IGluIGtleXMpIHtcbiAgICAgIHJlcXVlc3RTaXplICs9IEJ1ZmZlci5ieXRlTGVuZ3RoKGtleXNba2V5SWR4XSwgXCJ1dGY4XCIpICsgMjQ7XG4gICAgfVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IEJ1ZmZlci5hbGxvYyhyZXF1ZXN0U2l6ZSk7XG5cbiAgICBsZXQgYnl0ZXNXcml0dGVuID0gMDtcbiAgICBmb3IgKGNvbnN0IGtleUlkeCBpbiBrZXlzKSB7XG4gICAgICBjb25zdCBrZXkgPSBrZXlzW2tleUlkeF07XG4gICAgICBieXRlc1dyaXR0ZW4gKz0gY29weUludG9SZXF1ZXN0QnVmZmVyKFxuICAgICAgICBjb25zdGFudHMuT1BfR0VUS1EsXG4gICAgICAgIGtleSxcbiAgICAgICAgXCJcIixcbiAgICAgICAgXCJcIixcbiAgICAgICAgc2VxLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICBieXRlc1dyaXR0ZW5cbiAgICAgICk7XG4gICAgfVxuXG4gICAgYnl0ZXNXcml0dGVuICs9IGNvcHlJbnRvUmVxdWVzdEJ1ZmZlcihcbiAgICAgIGNvbnN0YW50cy5PUF9OT19PUCxcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiLFxuICAgICAgXCJcIixcbiAgICAgIHNlcSxcbiAgICAgIHJlcXVlc3QsXG4gICAgICBieXRlc1dyaXR0ZW5cbiAgICApO1xuXG4gICAgcmV0dXJuIHJlcXVlc3Q7XG4gIH1cblxuICAvKiogRXhlY3V0aW5nIGEgcGlwZWxpbmVkIChtdWx0aSkgZ2V0IGFnYWluc3QgYSBzaW5nbGUgc2VydmVyLiBUaGlzIGlzIGEgcHJpdmF0ZSBpbXBsZW1lbnRhdGlvbiBkZXRhaWwgb2YgZ2V0TXVsdGkuICovXG4gIGFzeW5jIF9nZXRNdWx0aVRvU2VydmVyPEtleXMgZXh0ZW5kcyBzdHJpbmc+KFxuICAgIHNlcnY6IFNlcnZlcixcbiAgICBrZXlzOiBLZXlzW11cbiAgKTogUHJvbWlzZTxHZXRNdWx0aVJlc3VsdDxLZXlzLCBWYWx1ZSwgRXh0cmFzPj4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZU1hcDogR2V0TXVsdGlSZXN1bHQ8c3RyaW5nLCBWYWx1ZSwgRXh0cmFzPiA9IHt9O1xuXG4gICAgICBjb25zdCBoYW5kbGU6IE9uUmVzcG9uc2VDYWxsYmFjayA9IChyZXNwb25zZSkgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGdldCB0aGUgbm8tb3AgcmVzcG9uc2UsIHdlIGFyZSBkb25lIHdpdGggdGhpcyBvbmUgZ2V0TXVsdGkgaW4gdGhlIHBlci1iYWNrZW5kIGZhbi1vdXRcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5oZWFkZXIub3Bjb2RlID09PSBjb25zdGFudHMuT1BfTk9fT1ApIHtcbiAgICAgICAgICAgICAgLy8gVGhpcyBlbnN1cmVzIHRoZSBoYW5kbGVyIHdpbGwgYmUgZGVsZXRlZCBmcm9tIHRoZSByZXNwb25zZUNhbGxiYWNrcyBtYXAgaW4gc2VydmVyLmpzXG4gICAgICAgICAgICAgIC8vIFRoaXMgaXNuJ3QgdGVjaG5pY2FsbHkgbmVlZGVkIGhlcmUgYmVjYXVzZSB0aGUgbG9naWMgaW4gc2VydmVyLmpzIGFsc28gY2hlY2tzIGlmIHRvdGFsQm9keUxlbmd0aCA9PT0gMCwgYnV0IG91ciB1bml0dGVzdHMgYXJlbid0IGdyZWF0IGFib3V0IHNldHRpbmcgdGhhdCBmaWVsZCwgYW5kIGFsc28gdGhpcyBtYWtlcyBpdCBtb3JlIGV4cGxpY2l0XG4gICAgICAgICAgICAgIGhhbmRsZS5xdWlldCA9IGZhbHNlO1xuICAgICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlTWFwKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgICAgIHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IGNvbnN0YW50cy5PUF9HRVRLIHx8XG4gICAgICAgICAgICAgIHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IGNvbnN0YW50cy5PUF9HRVRLUVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5kZXNlcmlhbGl6ZShcbiAgICAgICAgICAgICAgICByZXNwb25zZS5oZWFkZXIub3Bjb2RlLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLnZhbCxcbiAgICAgICAgICAgICAgICByZXNwb25zZS5leHRyYXNcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgY29uc3Qga2V5ID0gcmVzcG9uc2Uua2V5LnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgIGlmIChrZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgICAgIG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICAgICAgXCJSZWNpZXZlZCBlbXB0eSBrZXkgaW4gZ2V0TXVsdGk6IFwiICtcbiAgICAgICAgICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZSlcbiAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlc3BvbnNlTWFwW2tleV0gPSB7IC4uLmRlc2VyaWFsaXplZCwgY2FzOiByZXNwb25zZS5oZWFkZXIuY2FzIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICAgIFwiUmVjaWV2ZWQgcmVzcG9uc2UgaW4gZ2V0TXVsdGkgZm9yIHVua25vd24gb3Bjb2RlOiBcIiArXG4gICAgICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiR0VUXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgLy8gVGhpcyBwcmV2ZW50cyB0aGUgaGFuZGxlciBmcm9tIGJlaW5nIGRlbGV0ZWRcbiAgICAgIC8vIGFmdGVyIHRoZSBmaXJzdCByZXNwb25zZS4gTG9naWMgaW4gc2VydmVyLmpzLlxuICAgICAgaGFuZGxlLnF1aWV0ID0gdHJ1ZTtcblxuICAgICAgY29uc3Qgc2VxID0gdGhpcy5pbmNyU2VxKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gdGhpcy5fYnVpbGRHZXRNdWx0aVJlcXVlc3Qoa2V5cywgc2VxKTtcbiAgICAgIHNlcnYub25SZXNwb25zZSh0aGlzLnNlcSwgaGFuZGxlKTtcbiAgICAgIHNlcnYub25FcnJvcih0aGlzLnNlcSwgcmVqZWN0KTtcbiAgICAgIHNlcnYud3JpdGUocmVxdWVzdCk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldnMgdGhlIHZhbHVlIGF0IHRoZSBnaXZlbiBrZXlzIGluIG1lbWNhY2hlZC4gUmV0dXJucyBhIG1hcCBmcm9tIHRoZVxuICAgKiByZXF1ZXN0ZWQga2V5cyB0byByZXN1bHRzLCBvciBudWxsIGlmIHRoZSBrZXkgd2FzIG5vdCBmb3VuZC5cbiAgICovXG4gIGFzeW5jIGdldE11bHRpPEtleXMgZXh0ZW5kcyBzdHJpbmc+KFxuICAgIGtleXM6IEtleXNbXVxuICApOiBQcm9taXNlPEdldE11bHRpUmVzdWx0PEtleXMsIFZhbHVlLCBFeHRyYXM+PiB7XG4gICAgY29uc3Qgc2VydmVyS2V5dG9Mb29rdXBLZXlzOiB7XG4gICAgICBbc2VydmVyS2V5OiBzdHJpbmddOiBzdHJpbmdbXTtcbiAgICB9ID0ge307XG4gICAga2V5cy5mb3JFYWNoKChsb29rdXBLZXkpID0+IHtcbiAgICAgIGNvbnN0IHNlcnZlcktleSA9IHRoaXMubG9va3VwS2V5VG9TZXJ2ZXJLZXkobG9va3VwS2V5KTtcbiAgICAgIGlmICghc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0pIHtcbiAgICAgICAgc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0gPSBbXTtcbiAgICAgIH1cbiAgICAgIHNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldLnB1c2gobG9va3VwS2V5KTtcbiAgICB9KTtcblxuICAgIGNvbnN0IHVzZWRTZXJ2ZXJLZXlzID0gT2JqZWN0LmtleXMoc2VydmVyS2V5dG9Mb29rdXBLZXlzKTtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICB1c2VkU2VydmVyS2V5cy5tYXAoKHNlcnZlcktleSkgPT4ge1xuICAgICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9nZXRNdWx0aVRvU2VydmVyKHNlcnZlciwgc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0pO1xuICAgICAgfSlcbiAgICApO1xuXG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIC4uLnJlc3VsdHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgYGtleWAgdG8gYHZhbHVlYC5cbiAgICovXG4gIGFzeW5jIHNldChcbiAgICBrZXk6IHN0cmluZyxcbiAgICB2YWx1ZTogVmFsdWUsXG4gICAgb3B0aW9ucz86IHsgZXhwaXJlcz86IG51bWJlcjsgY2FzPzogQ0FTVG9rZW4gfVxuICApOiBQcm9taXNlPGJvb2xlYW4gfCBudWxsPiB7XG4gICAgY29uc3QgZXhwaXJlcyA9IG9wdGlvbnM/LmV4cGlyZXM7XG4gICAgY29uc3QgY2FzID0gb3B0aW9ucz8uY2FzO1xuXG4gICAgLy8gVE9ETzogc3VwcG9ydCBmbGFnc1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBtYWtlRXhwaXJhdGlvbihleHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCBleHRyYXMgPSBCdWZmZXIuY29uY2F0KFtCdWZmZXIuZnJvbShcIjAwMDAwMDAwXCIsIFwiaGV4XCIpLCBleHBpcmF0aW9uXSk7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUoXG4gICAgICBjb25zdGFudHMuT1BfU0VULFxuICAgICAgdmFsdWUsXG4gICAgICBleHRyYXNcbiAgICApO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBVdGlscy5lbmNvZGVSZXF1ZXN0KHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICBvcGNvZGU6IGNvbnN0YW50cy5PUF9TRVQsXG4gICAgICAgIG9wYXF1ZTogdGhpcy5zZXEsXG4gICAgICAgIGNhcyxcbiAgICAgIH0sXG4gICAgICBrZXksXG4gICAgICB2YWx1ZTogc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIGV4dHJhczogc2VyaWFsaXplZC5leHRyYXMsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfRVhJU1RTOlxuICAgICAgICBpZiAoY2FzKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJTRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJTRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFERFxuICAgKlxuICAgKiBBZGRzIHRoZSBnaXZlbiBfa2V5XyBhbmQgX3ZhbHVlXyB0byBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzXG4gICAqIGlmIHRoZSBrZXkgaXMgbm90IGFscmVhZHkgc2V0LlxuICAgKlxuICAgKiBUaGUgb3B0aW9ucyBkaWN0aW9uYXJ5IHRha2VzOlxuICAgKiAqIF9leHBpcmVzXzogb3ZlcnJpZGVzIHRoZSBkZWZhdWx0IGV4cGlyYXRpb24gKHNlZSBgQ2xpZW50LmNyZWF0ZWApIGZvciB0aGlzXG4gICAqICAgICAgICAgICAgICBwYXJ0aWN1bGFyIGtleS12YWx1ZSBwYWlyLlxuICAgKi9cbiAgYXN5bmMgYWRkKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHZhbHVlOiBWYWx1ZSxcbiAgICBvcHRpb25zPzogeyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTxib29sZWFuIHwgbnVsbD4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgZmxhZ3MsIHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBtYWtlRXhwaXJhdGlvbihvcHRpb25zPy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCBleHRyYXMgPSBCdWZmZXIuY29uY2F0KFtCdWZmZXIuZnJvbShcIjAwMDAwMDAwXCIsIFwiaGV4XCIpLCBleHBpcmF0aW9uXSk7XG5cbiAgICBjb25zdCBvcGNvZGUgPSBjb25zdGFudHMuT1BfQUREO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIGV4dHJhcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX0VYSVNUUzpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJBRERcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBnaXZlbiBfa2V5XyBhbmQgX3ZhbHVlXyB0byBtZW1jYWNoZS4gVGhlIG9wZXJhdGlvbiBvbmx5IHN1Y2NlZWRzXG4gICAqIGlmIHRoZSBrZXkgaXMgYWxyZWFkeSBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZShcbiAgICBrZXk6IHN0cmluZyxcbiAgICB2YWx1ZTogVmFsdWUsXG4gICAgb3B0aW9ucz86IHsgZXhwaXJlcz86IG51bWJlciB9XG4gICk6IFByb21pc2U8Ym9vbGVhbiB8IG51bGw+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IGZsYWdzLCBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBleHBpcmF0aW9uID0gbWFrZUV4cGlyYXRpb24ob3B0aW9ucz8uZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcyk7XG4gICAgY29uc3QgZXh0cmFzID0gQnVmZmVyLmNvbmNhdChbQnVmZmVyLmZyb20oXCIwMDAwMDAwMFwiLCBcImhleFwiKSwgZXhwaXJhdGlvbl0pO1xuXG4gICAgY29uc3Qgb3Bjb2RlOiBjb25zdGFudHMuT1AgPSBjb25zdGFudHMuT1BfUkVQTEFDRTtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShvcGNvZGUsIHZhbHVlLCBleHRyYXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJSRVBMQUNFXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRoZSBnaXZlbiBfa2V5XyBmcm9tIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHNcbiAgICogaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBkZWxldGUoa2V5OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBTdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoNCwga2V5LCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG5cbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJERUxFVEVcIiwgcmVzcG9uc2U/LmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbmNyZW1lbnRzIHRoZSBnaXZlbiBfa2V5XyBpbiBtZW1jYWNoZS5cbiAgICovXG4gIGFzeW5jIGluY3JlbWVudChcbiAgICBrZXk6IHN0cmluZyxcbiAgICBhbW91bnQ6IG51bWJlcixcbiAgICBvcHRpb25zPzogeyBpbml0aWFsPzogbnVtYmVyOyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTx7IHZhbHVlOiBudW1iZXIgfCBudWxsOyBzdWNjZXNzOiBib29sZWFuIHwgbnVsbCB9PiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgaW5pdGlhbCA9IG9wdGlvbnM/LmluaXRpYWwgfHwgMDtcbiAgICBjb25zdCBleHBpcmVzID0gb3B0aW9ucz8uZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcztcbiAgICBjb25zdCBleHRyYXMgPSBtYWtlQW1vdW50SW5pdGlhbEFuZEV4cGlyYXRpb24oYW1vdW50LCBpbml0aWFsLCBleHBpcmVzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBjb25zdGFudHMuT1BfSU5DUkVNRU5ULFxuICAgICAga2V5LFxuICAgICAgZXh0cmFzLFxuICAgICAgXCJcIixcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgY29uc3QgYnVmSW50ID1cbiAgICAgICAgICAocmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSgwKSA8PCA4KSArIHJlc3BvbnNlLnZhbC5yZWFkVUludDMyQkUoNCk7XG4gICAgICAgIHJldHVybiB7IHZhbHVlOiBidWZJbnQsIHN1Y2Nlc3M6IHRydWUgfTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJJTkNSRU1FTlRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlY3JlbWVudHMgdGhlIGdpdmVuIGBrZXlgIGluIG1lbWNhY2hlLlxuICAgKi9cbiAgYXN5bmMgZGVjcmVtZW50KFxuICAgIGtleTogc3RyaW5nLFxuICAgIGFtb3VudDogbnVtYmVyLFxuICAgIG9wdGlvbnM6IHsgaW5pdGlhbD86IG51bWJlcjsgZXhwaXJlcz86IG51bWJlciB9XG4gICk6IFByb21pc2U8eyB2YWx1ZTogbnVtYmVyIHwgbnVsbDsgc3VjY2VzczogYm9vbGVhbiB8IG51bGwgfT4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGluaXRpYWwgPSBvcHRpb25zLmluaXRpYWwgfHwgMDtcbiAgICBjb25zdCBleHBpcmVzID0gb3B0aW9ucy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzO1xuICAgIGNvbnN0IGV4dHJhcyA9IG1ha2VBbW91bnRJbml0aWFsQW5kRXhwaXJhdGlvbihhbW91bnQsIGluaXRpYWwsIGV4cGlyZXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIGNvbnN0YW50cy5PUF9ERUNSRU1FTlQsXG4gICAgICBrZXksXG4gICAgICBleHRyYXMsXG4gICAgICBcIlwiLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICBjb25zdCBidWZJbnQgPVxuICAgICAgICAgIChyZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDApIDw8IDgpICsgcmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSg0KTtcbiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJ1ZkludCwgc3VjY2VzczogdHJ1ZSB9O1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkRFQ1JFTUVOVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwZW5kIHRoZSBnaXZlbiBfdmFsdWVfIHRvIHRoZSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGggdGhlIGdpdmVuIF9rZXlfIGluXG4gICAqIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHMgaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBhcHBlbmQoa2V5OiBzdHJpbmcsIHZhbHVlOiBWYWx1ZSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IG9wY29kZTogY29uc3RhbnRzLk9QID0gY29uc3RhbnRzLk9QX0FQUEVORDtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShvcGNvZGUsIHZhbHVlLCBcIlwiKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBvcGNvZGUsXG4gICAgICBrZXksXG4gICAgICBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICAgIHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiQVBQRU5EXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwZW5kIHRoZSBnaXZlbiBfdmFsdWVfIHRvIHRoZSB2YWx1ZSBhc3NvY2lhdGVkIHdpdGggdGhlIGdpdmVuIF9rZXlfIGluXG4gICAqIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHMgaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBwcmVwZW5kKGtleTogc3RyaW5nLCB2YWx1ZTogVmFsdWUpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBvcGNvZGU6IGNvbnN0YW50cy5PUCA9IGNvbnN0YW50cy5PUF9QUkVQRU5EO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIFwiXCIpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJQUkVQRU5EXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUb3VjaCBzZXRzIGFuIGV4cGlyYXRpb24gdmFsdWUsIGdpdmVuIGJ5IF9leHBpcmVzXywgb24gdGhlIGdpdmVuIF9rZXlfIGluXG4gICAqIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHMgaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyB0b3VjaChrZXk6IHN0cmluZywgZXhwaXJlczogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXh0cmFzID0gbWFrZUV4cGlyYXRpb24oZXhwaXJlcyB8fCB0aGlzLm9wdGlvbnMuZXhwaXJlcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MWMsIGtleSwgZXh0cmFzLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfTk9UX0ZPVU5EOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiVE9VQ0hcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZMVVNIXG4gICAqXG4gICAqIEZsdXNoZXMgdGhlIGNhY2hlIG9uIGVhY2ggY29ubmVjdGVkIHNlcnZlci4gVGhlIGNhbGxiYWNrIHNpZ25hdHVyZSBpczpcbiAgICpcbiAgICogICAgIGNhbGxiYWNrKGxhc3RFcnIsIHJlc3VsdHMpXG4gICAqXG4gICAqIHdoZXJlIF9sYXN0RXJyXyBpcyB0aGUgbGFzdCBlcnJvciBlbmNvdW50ZXJlZCAob3IgbnVsbCwgaW4gdGhlIGNvbW1vbiBjYXNlXG4gICAqIG9mIG5vIGVycm9ycykuIF9yZXN1bHRzXyBpcyBhIGRpY3Rpb25hcnkgbWFwcGluZyBgXCJob3N0bmFtZTpwb3J0XCJgIHRvIGVpdGhlclxuICAgKiBgdHJ1ZWAgKGlmIHRoZSBvcGVyYXRpb24gd2FzIHN1Y2Nlc3NmdWwpLCBvciBhbiBlcnJvci5cbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICBmbHVzaCgpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj4+O1xuICBmbHVzaChcbiAgICBjYWxsYmFjazogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICByZXN1bHRzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+XG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQ7XG4gIGZsdXNoKFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICByZXN1bHRzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+XG4gICAgKSA9PiB2b2lkXG4gICkge1xuICAgIGlmIChjYWxsYmFjayA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5KChjYWxsYmFjaykgPT4ge1xuICAgICAgICB0aGlzLmZsdXNoKGZ1bmN0aW9uIChlcnIsIHJlc3VsdHMpIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnIsIHJlc3VsdHMpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICAvLyBUT0RPOiBzdXBwb3J0IGV4cGlyYXRpb25cbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgwOCwgXCJcIiwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpO1xuICAgIGxldCBjb3VudCA9IHRoaXMuc2VydmVycy5sZW5ndGg7XG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgRXJyb3I+ID0ge307XG4gICAgbGV0IGxhc3RFcnI6IEVycm9yIHwgbnVsbCA9IG51bGw7XG5cbiAgICBjb25zdCBoYW5kbGVGbHVzaCA9IGZ1bmN0aW9uIChzZXE6IG51bWJlciwgc2VydjogU2VydmVyKSB7XG4gICAgICBzZXJ2Lm9uUmVzcG9uc2Uoc2VxLCBmdW5jdGlvbiAoLyogcmVzcG9uc2UgKi8pIHtcbiAgICAgICAgY291bnQgLT0gMTtcbiAgICAgICAgcmVzdWx0W3NlcnYuaG9zdHBvcnRTdHJpbmcoKV0gPSB0cnVlO1xuICAgICAgICBpZiAoY2FsbGJhY2sgJiYgY291bnQgPT09IDApIHtcbiAgICAgICAgICBjYWxsYmFjayhsYXN0RXJyLCByZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlcnYub25FcnJvcihzZXEsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgY291bnQgLT0gMTtcbiAgICAgICAgbGFzdEVyciA9IGVycjtcbiAgICAgICAgcmVzdWx0W3NlcnYuaG9zdHBvcnRTdHJpbmcoKV0gPSBlcnI7XG4gICAgICAgIGlmIChjYWxsYmFjayAmJiBjb3VudCA9PT0gMCkge1xuICAgICAgICAgIGNhbGxiYWNrKGxhc3RFcnIsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGhhbmRsZUZsdXNoKHRoaXMuc2VxLCB0aGlzLnNlcnZlcnNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTVEFUU19XSVRIX0tFWVxuICAgKlxuICAgKiBTZW5kcyBhIG1lbWNhY2hlIHN0YXRzIGNvbW1hbmQgd2l0aCBhIGtleSB0byBlYWNoIGNvbm5lY3RlZCBzZXJ2ZXIuIFRoZVxuICAgKiBjYWxsYmFjayBpcyBpbnZva2VkICoqT05DRSBQRVIgU0VSVkVSKiogYW5kIGhhcyB0aGUgc2lnbmF0dXJlOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2soZXJyLCBzZXJ2ZXIsIHN0YXRzKVxuICAgKlxuICAgKiBfc2VydmVyXyBpcyB0aGUgYFwiaG9zdG5hbWU6cG9ydFwiYCBvZiB0aGUgc2VydmVyLCBhbmQgX3N0YXRzXyBpcyBhIGRpY3Rpb25hcnlcbiAgICogbWFwcGluZyB0aGUgc3RhdCBuYW1lIHRvIHRoZSB2YWx1ZSBvZiB0aGUgc3RhdGlzdGljIGFzIGEgc3RyaW5nLlxuICAgKiBAcGFyYW0ga2V5XG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgc3RhdHNXaXRoS2V5KFxuICAgIGtleTogc3RyaW5nLFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICBzZXJ2ZXI6IHN0cmluZyxcbiAgICAgIHN0YXRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbFxuICAgICkgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgxMCwga2V5LCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG5cbiAgICBjb25zdCBoYW5kbGVTdGF0cyA9IChzZXE6IG51bWJlciwgc2VydjogU2VydmVyKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgICAgIGNvbnN0IGhhbmRsZTogT25SZXNwb25zZUNhbGxiYWNrID0gKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIC8vIGVuZCBvZiBzdGF0IHJlc3BvbnNlc1xuICAgICAgICBpZiAocmVzcG9uc2UuaGVhZGVyLnRvdGFsQm9keUxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgc2Vydi5ob3N0cG9ydFN0cmluZygpLCByZXN1bHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gcHJvY2VzcyBzaW5nbGUgc3RhdCBsaW5lIHJlc3BvbnNlXG4gICAgICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgICAgIHJlc3VsdFtyZXNwb25zZS5rZXkudG9TdHJpbmcoKV0gPSByZXNwb25zZS52YWwudG9TdHJpbmcoKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuaGFuZGxlUmVzcG9uc2VFcnJvcihcbiAgICAgICAgICAgICAgYFNUQVRTICgke2tleX0pYCxcbiAgICAgICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCBzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCksIG51bGwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaGFuZGxlLnF1aWV0ID0gdHJ1ZTtcblxuICAgICAgc2Vydi5vblJlc3BvbnNlKHNlcSwgaGFuZGxlKTtcbiAgICAgIHNlcnYub25FcnJvcihzZXEsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyLCBzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCksIG51bGwpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlcnYud3JpdGUocmVxdWVzdCk7XG4gICAgfTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYW5kbGVTdGF0cyh0aGlzLnNlcSwgdGhpcy5zZXJ2ZXJzW2ldKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU1RBVFNcbiAgICpcbiAgICogRmV0Y2hlcyBtZW1jYWNoZSBzdGF0cyBmcm9tIGVhY2ggY29ubmVjdGVkIHNlcnZlci4gVGhlIGNhbGxiYWNrIGlzIGludm9rZWRcbiAgICogKipPTkNFIFBFUiBTRVJWRVIqKiBhbmQgaGFzIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhlcnIsIHNlcnZlciwgc3RhdHMpXG4gICAqXG4gICAqIF9zZXJ2ZXJfIGlzIHRoZSBgXCJob3N0bmFtZTpwb3J0XCJgIG9mIHRoZSBzZXJ2ZXIsIGFuZCBfc3RhdHNfIGlzIGFcbiAgICogZGljdGlvbmFyeSBtYXBwaW5nIHRoZSBzdGF0IG5hbWUgdG8gdGhlIHZhbHVlIG9mIHRoZSBzdGF0aXN0aWMgYXMgYSBzdHJpbmcuXG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgc3RhdHMoXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHNlcnZlcjogc3RyaW5nLFxuICAgICAgc3RhdHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsXG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHNXaXRoS2V5KFwiXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSRVNFVF9TVEFUU1xuICAgKlxuICAgKiBSZXNldCB0aGUgc3RhdGlzdGljcyBlYWNoIHNlcnZlciBpcyBrZWVwaW5nIGJhY2sgdG8gemVyby4gVGhpcyBkb2Vzbid0IGNsZWFyXG4gICAqIHN0YXRzIHN1Y2ggYXMgaXRlbSBjb3VudCwgYnV0IHRlbXBvcmFyeSBzdGF0cyBzdWNoIGFzIHRvdGFsIG51bWJlciBvZlxuICAgKiBjb25uZWN0aW9ucyBvdmVyIHRpbWUuXG4gICAqXG4gICAqIFRoZSBjYWxsYmFjayBpcyBpbnZva2VkICoqT05DRSBQRVIgU0VSVkVSKiogYW5kIGhhcyB0aGUgc2lnbmF0dXJlOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2soZXJyLCBzZXJ2ZXIpXG4gICAqXG4gICAqIF9zZXJ2ZXJfIGlzIHRoZSBgXCJob3N0bmFtZTpwb3J0XCJgIG9mIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSBjYWxsYmFja1xuICAgKi9cbiAgcmVzZXRTdGF0cyhcbiAgICBjYWxsYmFjaz86IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgc2VydmVyOiBzdHJpbmcsXG4gICAgICBzdGF0czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IG51bGxcbiAgICApID0+IHZvaWRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0c1dpdGhLZXkoXCJyZXNldFwiLCBjYWxsYmFjayk7XG4gIH1cblxuICAvKipcbiAgICogUVVJVFxuICAgKlxuICAgKiBDbG9zZXMgdGhlIGNvbm5lY3Rpb24gdG8gZWFjaCBzZXJ2ZXIsIG5vdGlmeWluZyB0aGVtIG9mIHRoaXMgaW50ZW50aW9uLiBOb3RlXG4gICAqIHRoYXQgcXVpdCBjYW4gcmFjZSBhZ2FpbnN0IGFscmVhZHkgb3V0c3RhbmRpbmcgcmVxdWVzdHMgd2hlbiB0aG9zZSByZXF1ZXN0c1xuICAgKiBmYWlsIGFuZCBhcmUgcmV0cmllZCwgbGVhZGluZyB0byB0aGUgcXVpdCBjb21tYW5kIHdpbm5pbmcgYW5kIGNsb3NpbmcgdGhlXG4gICAqIGNvbm5lY3Rpb24gYmVmb3JlIHRoZSByZXRyaWVzIGNvbXBsZXRlLlxuICAgKi9cbiAgcXVpdCgpIHtcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICAvLyBUT0RPOiBOaWNlciBwZXJoYXBzIHRvIGRvIFFVSVRRICgweDE3KSBidXQgbmVlZCBhIG5ldyBjYWxsYmFjayBmb3Igd2hlblxuICAgIC8vIHdyaXRlIGlzIGRvbmUuXG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MDcsIFwiXCIsIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTsgLy8gUVVJVFxuICAgIGxldCBzZXJ2O1xuXG4gICAgY29uc3QgaGFuZGxlUXVpdCA9IGZ1bmN0aW9uIChzZXE6IG51bWJlciwgc2VydjogU2VydmVyKSB7XG4gICAgICBzZXJ2Lm9uUmVzcG9uc2Uoc2VxLCBmdW5jdGlvbiAoLyogcmVzcG9uc2UgKi8pIHtcbiAgICAgICAgc2Vydi5jbG9zZSgpO1xuICAgICAgfSk7XG4gICAgICBzZXJ2Lm9uRXJyb3Ioc2VxLCBmdW5jdGlvbiAoLyogZXJyICovKSB7XG4gICAgICAgIHNlcnYuY2xvc2UoKTtcbiAgICAgIH0pO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHNlcnYgPSB0aGlzLnNlcnZlcnNbaV07XG4gICAgICBoYW5kbGVRdWl0KHRoaXMuc2VxLCBzZXJ2KTtcbiAgICB9XG4gIH1cblxuICBfdmVyc2lvbihzZXJ2ZXI6IFNlcnZlcik6IFByb21pc2U8eyB2YWx1ZTogVmFsdWUgfCBudWxsIH0+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICAgIGNvbnN0YW50cy5PUF9WRVJTSU9OLFxuICAgICAgICBcIlwiLFxuICAgICAgICBcIlwiLFxuICAgICAgICBcIlwiLFxuICAgICAgICB0aGlzLnNlcVxuICAgICAgKTtcbiAgICAgIHRoaXMucGVyZm9ybU9uU2VydmVyKHNlcnZlciwgcmVxdWVzdCwgdGhpcy5zZXEsIChlcnIsIHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cblxuICAgICAgICBzd2l0Y2ggKHJlc3BvbnNlIS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICAgICAgLyogVE9ETzogdGhpcyBpcyBidWdnZWQsIHdlIHNob3VsZCd0IHVzZSB0aGUgZGVzZXJpYWxpemVyIGhlcmUsIHNpbmNlIHZlcnNpb24gYWx3YXlzIHJldHVybnMgYSB2ZXJzaW9uIHN0cmluZy5cbiAgICAgICAgICAgICBUaGUgZGVzZXJpYWxpemVyIHNob3VsZCBvbmx5IGJlIHVzZWQgb24gdXNlciBrZXkgZGF0YS4gKi9cbiAgICAgICAgICAgIGNvbnN0IGRlc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5kZXNlcmlhbGl6ZShcbiAgICAgICAgICAgICAgcmVzcG9uc2UhLmhlYWRlci5vcGNvZGUsXG4gICAgICAgICAgICAgIHJlc3BvbnNlIS52YWwsXG4gICAgICAgICAgICAgIHJlc3BvbnNlIS5leHRyYXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXR1cm4gcmVzb2x2ZSh7IHZhbHVlOiBkZXNlcmlhbGl6ZWQudmFsdWUgfSk7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJWRVJTSU9OXCIsIHJlc3BvbnNlIS5oZWFkZXIuc3RhdHVzKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVxdWVzdCB0aGUgc2VydmVyIHZlcnNpb24gZnJvbSB0aGUgXCJmaXJzdFwiIHNlcnZlciBpbiB0aGUgYmFja2VuZCBwb29sLlxuICAgKiBUaGUgc2VydmVyIHJlc3BvbmRzIHdpdGggYSBwYWNrZXQgY29udGFpbmluZyB0aGUgdmVyc2lvbiBzdHJpbmcgaW4gdGhlIGJvZHkgd2l0aCB0aGUgZm9sbG93aW5nIGZvcm1hdDogXCJ4LnkuelwiXG4gICAqL1xuICB2ZXJzaW9uKCk6IFByb21pc2U8eyB2YWx1ZTogVmFsdWUgfCBudWxsIH0+IHtcbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHRoaXMuc2VydmVyS2V5c1swXSk7XG4gICAgcmV0dXJuIHRoaXMuX3ZlcnNpb24oc2VydmVyKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIHNlcnZlciB2ZXJzaW9uIGZyb20gYWxsIHRoZSBzZXJ2ZXJzXG4gICAqIGluIHRoZSBiYWNrZW5kIHBvb2wsIGVycm9ycyBpZiBhbnkgb25lIG9mIHRoZW0gaGFzIGFuXG4gICAqIGVycm9yXG4gICAqL1xuICBhc3luYyB2ZXJzaW9uQWxsKGNhbGxiYWNrcz86IHtcbiAgICBiZWZvcmVQaW5nPzogKHNlcnZlcktleTogc3RyaW5nKSA9PiB2b2lkO1xuICAgIGFmdGVyUGluZz86IChzZXJ2ZXJLZXk6IHN0cmluZykgPT4gdm9pZDtcbiAgfSk6IFByb21pc2U8e1xuICAgIHZhbHVlczogUmVjb3JkPHN0cmluZywgVmFsdWUgfCBudWxsPjtcbiAgfT4ge1xuICAgIGNvbnN0IHZlcnNpb25PYmplY3RzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICB0aGlzLnNlcnZlcktleXMubWFwKChzZXJ2ZXJLZXkpID0+IHtcbiAgICAgICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXkpO1xuICAgICAgICBjYWxsYmFja3M/LmJlZm9yZVBpbmc/LihzZXJ2ZXJLZXkpO1xuICAgICAgICByZXR1cm4gdGhpcy5fdmVyc2lvbihzZXJ2ZXIpLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgY2FsbGJhY2tzPy5hZnRlclBpbmc/LihzZXJ2ZXJLZXkpO1xuICAgICAgICAgIHJldHVybiB7IHNlcnZlcktleTogc2VydmVyS2V5LCB2YWx1ZTogcmVzcG9uc2UudmFsdWUgfTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgY29uc3QgdmFsdWVzID0gdmVyc2lvbk9iamVjdHMucmVkdWNlKChhY2N1bXVsYXRvciwgdmVyc2lvbk9iamVjdCkgPT4ge1xuICAgICAgYWNjdW11bGF0b3JbdmVyc2lvbk9iamVjdC5zZXJ2ZXJLZXldID0gdmVyc2lvbk9iamVjdC52YWx1ZTtcbiAgICAgIHJldHVybiBhY2N1bXVsYXRvcjtcbiAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBWYWx1ZSB8IG51bGw+KTtcbiAgICByZXR1cm4geyB2YWx1ZXM6IHZhbHVlcyB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyAoYWJydXB0bHkpIGNvbm5lY3Rpb25zIHRvIGFsbCB0aGUgc2VydmVycy5cbiAgICogQHNlZSB0aGlzLnF1aXRcbiAgICovXG4gIGNsb3NlKCkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGlzLnNlcnZlcnNbaV0uY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBhIGdlbmVyaWMgc2luZ2xlIHJlc3BvbnNlIG9wZXJhdGlvbiAoZ2V0LCBzZXQgZXRjKSBvbiBvbmUgc2VydmVyXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgdGhlIGtleSB0byBoYXNoIHRvIGdldCBhIHNlcnZlciBmcm9tIHRoZSBwb29sXG4gICAqIEBwYXJhbSB7YnVmZmVyfSByZXF1ZXN0IGEgYnVmZmVyIGNvbnRhaW5pbmcgdGhlIHJlcXVlc3RcbiAgICogQHBhcmFtIHtudW1iZXJ9IHNlcSB0aGUgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSBvcGVyYXRpb24uIEl0IGlzIHVzZWQgdG8gcGluIHRoZSBjYWxsYmFja3NcbiAgICAgICAgICAgICAgICAgICAgICAgICB0byBhIHNwZWNpZmljIG9wZXJhdGlvbiBhbmQgc2hvdWxkIG5ldmVyIGNoYW5nZSBkdXJpbmcgYSBgcGVyZm9ybWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyP30gcmV0cmllcyBudW1iZXIgb2YgdGltZXMgdG8gcmV0cnkgcmVxdWVzdCBvbiBmYWlsdXJlXG4gICAqL1xuICBwZXJmb3JtKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHJlcXVlc3Q6IEJ1ZmZlcixcbiAgICBzZXE6IG51bWJlcixcbiAgICByZXRyaWVzPzogbnVtYmVyXG4gICk6IFByb21pc2U8TWVzc2FnZT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBzZXJ2ZXJLZXkgPSB0aGlzLmxvb2t1cEtleVRvU2VydmVyS2V5KGtleSk7XG4gICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG5cbiAgICAgIGlmICghc2VydmVyKSB7XG4gICAgICAgIHJldHVybiByZWplY3QobmV3IEVycm9yKFwiTm8gc2VydmVycyBhdmFpbGFibGVcIikpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnBlcmZvcm1PblNlcnZlcihcbiAgICAgICAgc2VydmVyLFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICBzZXEsXG4gICAgICAgIChlcnJvciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlISk7XG4gICAgICAgIH0sXG4gICAgICAgIHJldHJpZXNcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwZXJmb3JtT25TZXJ2ZXIoXG4gICAgc2VydmVyOiBTZXJ2ZXIsXG4gICAgcmVxdWVzdDogQnVmZmVyLFxuICAgIHNlcTogbnVtYmVyLFxuICAgIGNhbGxiYWNrOiBSZXNwb25zZU9yRXJyb3JDYWxsYmFjayxcbiAgICByZXRyaWVzOiBudW1iZXIgPSAwXG4gICkge1xuICAgIGNvbnN0IF90aGlzID0gdGhpcztcblxuICAgIHJldHJpZXMgPSByZXRyaWVzIHx8IHRoaXMub3B0aW9ucy5yZXRyaWVzO1xuICAgIGNvbnN0IG9yaWdSZXRyaWVzID0gdGhpcy5vcHRpb25zLnJldHJpZXM7XG4gICAgY29uc3QgbG9nZ2VyID0gdGhpcy5vcHRpb25zLmxvZ2dlcjtcbiAgICBjb25zdCByZXRyeV9kZWxheSA9IHRoaXMub3B0aW9ucy5yZXRyeV9kZWxheTtcblxuICAgIGNvbnN0IHJlc3BvbnNlSGFuZGxlcjogT25SZXNwb25zZUNhbGxiYWNrID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzcG9uc2UpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCBlcnJvckhhbmRsZXI6IE9uRXJyb3JDYWxsYmFjayA9IGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgaWYgKC0tcmV0cmllcyA+IDApIHtcbiAgICAgICAgLy8gV2FpdCBmb3IgcmV0cnlfZGVsYXlcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgX3RoaXMucGVyZm9ybU9uU2VydmVyKHNlcnZlciwgcmVxdWVzdCwgc2VxLCBjYWxsYmFjaywgcmV0cmllcyk7XG4gICAgICAgIH0sIDEwMDAgKiByZXRyeV9kZWxheSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIubG9nKFxuICAgICAgICAgIFwiTWVtSlM6IFNlcnZlciA8XCIgK1xuICAgICAgICAgICAgc2VydmVyLmhvc3Rwb3J0U3RyaW5nKCkgK1xuICAgICAgICAgICAgXCI+IGZhaWxlZCBhZnRlciAoXCIgK1xuICAgICAgICAgICAgb3JpZ1JldHJpZXMgK1xuICAgICAgICAgICAgXCIpIHJldHJpZXMgd2l0aCBlcnJvciAtIFwiICtcbiAgICAgICAgICAgIGVycm9yLm1lc3NhZ2VcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHNlcnZlci5vblJlc3BvbnNlKHNlcSwgcmVzcG9uc2VIYW5kbGVyKTtcbiAgICBzZXJ2ZXIub25FcnJvcihzZXEsIGVycm9ySGFuZGxlcik7XG4gICAgc2VydmVyLndyaXRlKHJlcXVlc3QpO1xuICB9XG5cbiAgLy8gSW5jcmVtZW50IHRoZSBzZXEgdmFsdWVcbiAgaW5jclNlcSgpIHtcbiAgICB0aGlzLnNlcSsrO1xuXG4gICAgLy8gV3JhcCBgdGhpcy5zZXFgIHRvIDMyLWJpdHMgc2luY2UgdGhlIGZpZWxkIHdlIGZpdCBpdCBpbnRvIGlzIG9ubHkgMzItYml0cy5cbiAgICB0aGlzLnNlcSAmPSAweGZmZmZmZmZmO1xuXG4gICAgcmV0dXJuIHRoaXMuc2VxO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVBbmRMb2dFcnJvcihcbiAgICBjb21tYW5kTmFtZTogc3RyaW5nLFxuICAgIHJlc3BvbnNlU3RhdHVzOiBSZXNwb25zZVN0YXR1cyB8IHVuZGVmaW5lZFxuICApOiBFcnJvciB7XG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYE1lbUpTICR7Y29tbWFuZE5hbWV9OiAke2NvbnN0YW50cy5yZXNwb25zZVN0YXR1c1RvU3RyaW5nKFxuICAgICAgcmVzcG9uc2VTdGF0dXNcbiAgICApfWA7XG4gICAgdGhpcy5vcHRpb25zLmxvZ2dlci5sb2coZXJyb3JNZXNzYWdlKTtcbiAgICByZXR1cm4gbmV3IEVycm9yKGVycm9yTWVzc2FnZSk7XG4gIH1cblxuICAvKipcbiAgICogTG9nIGFuIGVycm9yIHRvIHRoZSBsb2dnZXIsIHRoZW4gcmV0dXJuIHRoZSBlcnJvci5cbiAgICogSWYgYSBjYWxsYmFjayBpcyBnaXZlbiwgY2FsbCBpdCB3aXRoIGNhbGxiYWNrKGVycm9yLCBudWxsKS5cbiAgICovXG4gIHByaXZhdGUgaGFuZGxlUmVzcG9uc2VFcnJvcihcbiAgICBjb21tYW5kTmFtZTogc3RyaW5nLFxuICAgIHJlc3BvbnNlU3RhdHVzOiBSZXNwb25zZVN0YXR1cyB8IHVuZGVmaW5lZCxcbiAgICBjYWxsYmFjazogdW5kZWZpbmVkIHwgKChlcnJvcjogRXJyb3IgfCBudWxsLCBvdGhlcjogbnVsbCkgPT4gdm9pZClcbiAgKTogRXJyb3Ige1xuICAgIGNvbnN0IGVycm9yID0gdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihjb21tYW5kTmFtZSwgcmVzcG9uc2VTdGF0dXMpO1xuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwpO1xuICAgIH1cbiAgICByZXR1cm4gZXJyb3I7XG4gIH1cbn1cblxuZXhwb3J0IHsgQ2xpZW50LCBTZXJ2ZXIsIFV0aWxzLCBIZWFkZXIgfTtcbiJdfQ==