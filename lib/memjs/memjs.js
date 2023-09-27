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
    async getMultiWithErrors(keys) {
        const serverKeytoLookupKeys = {};
        keys.forEach((lookupKey) => {
            const serverKey = this.lookupKeyToServerKey(lookupKey);
            if (!serverKeytoLookupKeys[serverKey]) {
                serverKeytoLookupKeys[serverKey] = [];
            }
            serverKeytoLookupKeys[serverKey].push(lookupKey);
        });
        const usedServerKeys = Object.keys(serverKeytoLookupKeys);
        const errors = [];
        const results = await Promise.all(usedServerKeys.map(async (serverKey) => {
            const server = this.serverKeyToServer(serverKey);
            try {
                return await this._getMultiToServer(server, serverKeytoLookupKeys[serverKey]);
            }
            catch (err) {
                let error;
                if (err instanceof Error) {
                    error = err;
                }
                else {
                    error = new Error("Unknown Error");
                    error.thrown = err;
                }
                errors.push({
                    error,
                    serverKey,
                    keys: serverKeytoLookupKeys[serverKey]
                });
            }
        }));
        return { result: Object.assign({}, ...results), errors };
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
     *
     * Callbacks functions are called before/after we ping memcached
     * and used to log which hosts are timing out.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVtanMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvbWVtanMvbWVtanMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLHdCQUF3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUV4QixxQ0FLa0I7QUFvbUNELHVGQXRtQ2YsZUFBTSxPQXNtQ2U7QUFubUN2Qix1REFBK0Q7QUFDL0QsbUNBU2lCO0FBQ2pCLHVEQUF5QztBQUN6QywyQ0FBNkM7QUFDN0MsK0NBQWlDO0FBc2xDUixzQkFBSztBQXJsQzlCLGlEQUFtQztBQXFsQ0gsd0JBQU07QUFubEN0QyxTQUFTLDhCQUE4QixDQUNyQyxPQUFpQixFQUNqQixHQUFXO0lBRVgsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUM3QixNQUFNLEtBQUssR0FBRyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hCLENBQUM7QUFFRCwrQ0FBK0M7QUFDL0MsU0FBUyxTQUFTLENBQ2hCLE9BQTBFO0lBRTFFLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxPQUFPLEVBQUUsTUFBTTtRQUMxQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUUsTUFBTTtZQUMzQixHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBd0VELE1BQU0sTUFBTTtJQVFWLDRFQUE0RTtJQUM1RSxtQ0FBbUM7SUFDbkMsWUFBWSxPQUFpQixFQUFFLE9BQTBDO1FBQ3ZFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElB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Q2xDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDeEIsQ0FBQztJQUVELDBCQUEwQjtJQUMxQixPQUFPO1FBQ0wsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRVgsNkVBQTZFO1FBQzdFLElBQUksQ0FBQyxHQUFHLElBQUksVUFBVSxDQUFDO1FBRXZCLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUNsQixDQUFDO0lBRU8saUJBQWlCLENBQ3ZCLFdBQW1CLEVBQ25CLGNBQTBDO1FBRTFDLE1BQU0sWUFBWSxHQUFHLFNBQVMsV0FBVyxLQUFLLFNBQVMsQ0FBQyxzQkFBc0IsQ0FDNUUsY0FBYyxDQUNmLEVBQUUsQ0FBQztRQUNKLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUN0QyxPQUFPLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7O09BR0c7SUFDSyxtQkFBbUIsQ0FDekIsV0FBbUIsRUFDbkIsY0FBMEMsRUFDMUMsUUFBa0U7UUFFbEUsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxjQUFjLENBQUMsQ0FBQztRQUNsRSxJQUFJLFFBQVEsRUFBRTtZQUNaLFFBQVEsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUM7U0FDdkI7UUFDRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7Q0FDRjtBQUVRLHdCQUFNIiwic291cmNlc0NvbnRlbnQiOlsiLy8gTWVtVFMgTWVtY2FjaGUgQ2xpZW50XG5cbmltcG9ydCB7XG4gIE9uRXJyb3JDYWxsYmFjayxcbiAgT25SZXNwb25zZUNhbGxiYWNrLFxuICBTZXJ2ZXIsXG4gIFNlcnZlck9wdGlvbnMsXG59IGZyb20gXCIuL3NlcnZlclwiO1xuaW1wb3J0IHsgbm9vcFNlcmlhbGl6ZXIsIFNlcmlhbGl6ZXIgfSBmcm9tIFwiLi9ub29wLXNlcmlhbGl6ZXJcIjtcbmltcG9ydCB7XG4gIG1ha2VSZXF1ZXN0QnVmZmVyLFxuICBjb3B5SW50b1JlcXVlc3RCdWZmZXIsXG4gIG1lcmdlLFxuICBtYWtlRXhwaXJhdGlvbixcbiAgbWFrZUFtb3VudEluaXRpYWxBbmRFeHBpcmF0aW9uLFxuICBoYXNoQ29kZSxcbiAgTWF5YmVCdWZmZXIsXG4gIE1lc3NhZ2UsXG59IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQgKiBhcyBjb25zdGFudHMgZnJvbSBcIi4vY29uc3RhbnRzXCI7XG5pbXBvcnQgeyBSZXNwb25zZVN0YXR1cyB9IGZyb20gXCIuL2NvbnN0YW50c1wiO1xuaW1wb3J0ICogYXMgVXRpbHMgZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCAqIGFzIEhlYWRlciBmcm9tIFwiLi9oZWFkZXJcIjtcblxuZnVuY3Rpb24gZGVmYXVsdEtleVRvU2VydmVySGFzaEZ1bmN0aW9uKFxuICBzZXJ2ZXJzOiBzdHJpbmdbXSxcbiAga2V5OiBzdHJpbmdcbik6IHN0cmluZyB7XG4gIGNvbnN0IHRvdGFsID0gc2VydmVycy5sZW5ndGg7XG4gIGNvbnN0IGluZGV4ID0gdG90YWwgPiAxID8gaGFzaENvZGUoa2V5KSAlIHRvdGFsIDogMDtcbiAgcmV0dXJuIHNlcnZlcnNbaW5kZXhdO1xufVxuXG4vLyBjb252ZXJ0cyBhIGNhbGwgaW50byBhIHByb21pc2UtcmV0dXJuaW5nIG9uZVxuZnVuY3Rpb24gcHJvbWlzaWZ5PFJlc3VsdD4oXG4gIGNvbW1hbmQ6IChjYWxsYmFjazogKGVycm9yOiBFcnJvciB8IG51bGwsIHJlc3VsdDogUmVzdWx0KSA9PiB2b2lkKSA9PiB2b2lkXG4pOiBQcm9taXNlPFJlc3VsdD4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgIGNvbW1hbmQoZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUocmVzdWx0KTtcbiAgICB9KTtcbiAgfSk7XG59XG5cbnR5cGUgUmVzcG9uc2VPckVycm9yQ2FsbGJhY2sgPSAoXG4gIGVycm9yOiBFcnJvciB8IG51bGwsXG4gIHJlc3BvbnNlOiBNZXNzYWdlIHwgbnVsbFxuKSA9PiB2b2lkO1xuXG5pbnRlcmZhY2UgQmFzZUNsaWVudE9wdGlvbnMge1xuICByZXRyaWVzOiBudW1iZXI7XG4gIHJldHJ5X2RlbGF5OiBudW1iZXI7XG4gIGV4cGlyZXM6IG51bWJlcjtcbiAgbG9nZ2VyOiB7IGxvZzogdHlwZW9mIGNvbnNvbGUubG9nIH07XG4gIGtleVRvU2VydmVySGFzaEZ1bmN0aW9uOiB0eXBlb2YgZGVmYXVsdEtleVRvU2VydmVySGFzaEZ1bmN0aW9uO1xufVxuXG5pbnRlcmZhY2UgU2VyaWFsaXplclByb3A8VmFsdWUsIEV4dHJhcz4ge1xuICBzZXJpYWxpemVyOiBTZXJpYWxpemVyPFZhbHVlLCBFeHRyYXM+O1xufVxuXG4vKipcbiAqIFRoZSBjbGllbnQgaGFzIHBhcnRpYWwgc3VwcG9ydCBmb3Igc2VyaWFsaXppbmcgYW5kIGRlc2VyaWFsaXppbmcgdmFsdWVzIGZyb20gdGhlXG4gKiBCdWZmZXIgYnl0ZSBzdHJpbmdzIHdlIHJlY2VpdmUgZnJvbSB0aGUgd2lyZS4gVGhlIGRlZmF1bHQgc2VyaWFsaXplciBpcyBmb3IgTWF5YmVCdWZmZXIuXG4gKlxuICogSWYgVmFsdWUgYW5kIEV4dHJhcyBhcmUgb2YgdHlwZSBCdWZmZXIsIHRoZW4gcmV0dXJuIHR5cGUgV2hlbkJ1ZmZlci4gT3RoZXJ3aXNlLFxuICogcmV0dXJuIHR5cGUgTm90QnVmZmVyLlxuICovXG50eXBlIElmQnVmZmVyPFZhbHVlLCBFeHRyYXMsIFdoZW5WYWx1ZUFuZEV4dHJhc0FyZUJ1ZmZlcnMsIE5vdEJ1ZmZlcj4gPVxuICBWYWx1ZSBleHRlbmRzIEJ1ZmZlclxuICAgID8gRXh0cmFzIGV4dGVuZHMgQnVmZmVyXG4gICAgICA/IFdoZW5WYWx1ZUFuZEV4dHJhc0FyZUJ1ZmZlcnNcbiAgICAgIDogTm90QnVmZmVyXG4gICAgOiBOb3RCdWZmZXI7XG5cbmV4cG9ydCB0eXBlIEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPiA9IFBhcnRpYWw8QmFzZUNsaWVudE9wdGlvbnM+ICZcbiAgSWZCdWZmZXI8XG4gICAgVmFsdWUsXG4gICAgRXh0cmFzLFxuICAgIFBhcnRpYWw8U2VyaWFsaXplclByb3A8VmFsdWUsIEV4dHJhcz4+LFxuICAgIFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+XG4gID47XG5cbmV4cG9ydCB0eXBlIENBU1Rva2VuID0gQnVmZmVyO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdldFJlc3VsdDxWYWx1ZSA9IE1heWJlQnVmZmVyLCBFeHRyYXMgPSBNYXliZUJ1ZmZlcj4ge1xuICB2YWx1ZTogVmFsdWU7XG4gIGV4dHJhczogRXh0cmFzO1xuICBjYXM6IENBU1Rva2VuIHwgdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgdHlwZSBHZXRNdWx0aVJlc3VsdDxcbiAgS2V5cyBleHRlbmRzIHN0cmluZyA9IHN0cmluZyxcbiAgVmFsdWUgPSBNYXliZUJ1ZmZlcixcbiAgRXh0cmFzID0gTWF5YmVCdWZmZXJcbj4gPSB7XG4gIFtLIGluIEtleXNdPzogR2V0UmVzdWx0PFZhbHVlLCBFeHRyYXM+O1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBHZXRNdWx0aUVycm9yPEtleXMgZXh0ZW5kcyBzdHJpbmcgPSBzdHJpbmc+IHtcbiAgZXJyb3I6IEVycm9yO1xuICBzZXJ2ZXJLZXk6IHN0cmluZztcbiAga2V5czogS2V5c1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdldE11bHRpV2l0aEVycm9yc1Jlc3VsdDxcbktleXMgZXh0ZW5kcyBzdHJpbmcgPSBzdHJpbmcsXG5WYWx1ZSA9IE1heWJlQnVmZmVyLFxuRXh0cmFzID0gTWF5YmVCdWZmZXJcbj4ge1xuICByZXN1bHQ6IEdldE11bHRpUmVzdWx0PEtleXMsIFZhbHVlLCBFeHRyYXM+O1xuICBlcnJvcnM6IEdldE11bHRpRXJyb3I8S2V5cz5bXTtcbn1cblxuY2xhc3MgQ2xpZW50PFZhbHVlID0gTWF5YmVCdWZmZXIsIEV4dHJhcyA9IE1heWJlQnVmZmVyPiB7XG4gIHNlcnZlcnM6IFNlcnZlcltdO1xuICBzZXE6IG51bWJlcjtcbiAgb3B0aW9uczogQmFzZUNsaWVudE9wdGlvbnMgJiBQYXJ0aWFsPFNlcmlhbGl6ZXJQcm9wPFZhbHVlLCBFeHRyYXM+PjtcbiAgc2VyaWFsaXplcjogU2VyaWFsaXplcjxWYWx1ZSwgRXh0cmFzPjtcbiAgc2VydmVyTWFwOiB7IFtob3N0cG9ydDogc3RyaW5nXTogU2VydmVyIH07XG4gIHNlcnZlcktleXM6IHN0cmluZ1tdO1xuXG4gIC8vIENsaWVudCBpbml0aWFsaXplciB0YWtlcyBhIGxpc3Qgb2YgYFNlcnZlcmBzIGFuZCBhbiBgb3B0aW9uc2AgZGljdGlvbmFyeS5cbiAgLy8gU2VlIGBDbGllbnQuY3JlYXRlYCBmb3IgZGV0YWlscy5cbiAgY29uc3RydWN0b3Ioc2VydmVyczogU2VydmVyW10sIG9wdGlvbnM6IEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPikge1xuICAgIHRoaXMuc2VydmVycyA9IHNlcnZlcnM7XG4gICAgdGhpcy5zZXEgPSAwO1xuICAgIHRoaXMub3B0aW9ucyA9IG1lcmdlKG9wdGlvbnMgfHwge30sIHtcbiAgICAgIHJldHJpZXM6IDIsXG4gICAgICByZXRyeV9kZWxheTogMC4yLFxuICAgICAgZXhwaXJlczogMCxcbiAgICAgIGxvZ2dlcjogY29uc29sZSxcbiAgICAgIGtleVRvU2VydmVySGFzaEZ1bmN0aW9uOiBkZWZhdWx0S2V5VG9TZXJ2ZXJIYXNoRnVuY3Rpb24sXG4gICAgfSk7XG5cbiAgICB0aGlzLnNlcmlhbGl6ZXIgPSB0aGlzLm9wdGlvbnMuc2VyaWFsaXplciB8fCAobm9vcFNlcmlhbGl6ZXIgYXMgYW55KTtcblxuICAgIC8vIFN0b3JlIGEgbWFwcGluZyBmcm9tIGhvc3Rwb3J0IC0+IHNlcnZlciBzbyB3ZSBjYW4gcXVpY2tseSBnZXQgYSBzZXJ2ZXIgb2JqZWN0IGZyb20gdGhlIHNlcnZlcktleSByZXR1cm5lZCBieSB0aGUgaGFzaGluZyBmdW5jdGlvblxuICAgIGNvbnN0IHNlcnZlck1hcDogeyBbaG9zdHBvcnQ6IHN0cmluZ106IFNlcnZlciB9ID0ge307XG4gICAgdGhpcy5zZXJ2ZXJzLmZvckVhY2goZnVuY3Rpb24gKHNlcnZlcikge1xuICAgICAgc2VydmVyTWFwW3NlcnZlci5ob3N0cG9ydFN0cmluZygpXSA9IHNlcnZlcjtcbiAgICB9KTtcbiAgICB0aGlzLnNlcnZlck1hcCA9IHNlcnZlck1hcDtcblxuICAgIC8vIHN0b3JlIGEgbGlzdCBvZiBhbGwgb3VyIHNlcnZlcktleXMgc28gd2UgZG9uJ3QgbmVlZCB0byBjb25zdGFudGx5IHJlYWxsb2NhdGUgdGhpcyBhcnJheVxuICAgIHRoaXMuc2VydmVyS2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuc2VydmVyTWFwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGNsaWVudCBnaXZlbiBhbiBvcHRpb25hbCBjb25maWcgc3RyaW5nIGFuZCBvcHRpb25hbCBoYXNoIG9mXG4gICAqIG9wdGlvbnMuIFRoZSBjb25maWcgc3RyaW5nIHNob3VsZCBiZSBvZiB0aGUgZm9ybTpcbiAgICpcbiAgICogICAgIFwiW3VzZXI6cGFzc0Bdc2VydmVyMVs6MTEyMTFdLFt1c2VyOnBhc3NAXXNlcnZlcjJbOjExMjExXSwuLi5cIlxuICAgKlxuICAgKiBJZiB0aGUgYXJndW1lbnQgaXMgbm90IGdpdmVuLCBmYWxsYmFjayBvbiB0aGUgYE1FTUNBQ0hJRVJfU0VSVkVSU2AgZW52aXJvbm1lbnRcbiAgICogdmFyaWFibGUsIGBNRU1DQUNIRV9TRVJWRVJTYCBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBgXCJsb2NhbGhvc3Q6MTEyMTFcImAuXG4gICAqXG4gICAqIFRoZSBvcHRpb25zIGhhc2ggbWF5IGNvbnRhaW4gdGhlIG9wdGlvbnM6XG4gICAqXG4gICAqICogYHJldHJpZXNgIC0gdGhlIG51bWJlciBvZiB0aW1lcyB0byByZXRyeSBhbiBvcGVyYXRpb24gaW4gbGlldSBvZiBmYWlsdXJlc1xuICAgKiAoZGVmYXVsdCAyKVxuICAgKiAqIGBleHBpcmVzYCAtIHRoZSBkZWZhdWx0IGV4cGlyYXRpb24gaW4gc2Vjb25kcyB0byB1c2UgKGRlZmF1bHQgMCAtIG5ldmVyXG4gICAqIGV4cGlyZSkuIElmIGBleHBpcmVzYCBpcyBncmVhdGVyIHRoYW4gMzAgZGF5cyAoNjAgeCA2MCB4IDI0IHggMzApLCBpdCBpc1xuICAgKiB0cmVhdGVkIGFzIGEgVU5JWCB0aW1lIChudW1iZXIgb2Ygc2Vjb25kcyBzaW5jZSBKYW51YXJ5IDEsIDE5NzApLlxuICAgKiAqIGBsb2dnZXJgIC0gYSBsb2dnZXIgb2JqZWN0IHRoYXQgcmVzcG9uZHMgdG8gYGxvZyhzdHJpbmcpYCBtZXRob2QgY2FsbHMuXG4gICAqXG4gICAqICAgfn5+flxuICAgKiAgICAgbG9nKG1zZzFbLCBtc2cyWywgbXNnM1suLi5dXV0pXG4gICAqICAgfn5+flxuICAgKlxuICAgKiAgIERlZmF1bHRzIHRvIGBjb25zb2xlYC5cbiAgICogKiBgc2VyaWFsaXplcmAgLSB0aGUgb2JqZWN0IHdoaWNoIHdpbGwgKGRlKXNlcmlhbGl6ZSB0aGUgZGF0YS4gSXQgbmVlZHNcbiAgICogICB0d28gcHVibGljIG1ldGhvZHM6IHNlcmlhbGl6ZSBhbmQgZGVzZXJpYWxpemUuIEl0IGRlZmF1bHRzIHRvIHRoZVxuICAgKiAgIG5vb3BTZXJpYWxpemVyOlxuICAgKlxuICAgKiAgIH5+fn5cbiAgICogICBjb25zdCBub29wU2VyaWFsaXplciA9IHtcbiAgICogICAgIHNlcmlhbGl6ZTogZnVuY3Rpb24gKG9wY29kZSwgdmFsdWUsIGV4dHJhcykge1xuICAgKiAgICAgICByZXR1cm4geyB2YWx1ZTogdmFsdWUsIGV4dHJhczogZXh0cmFzIH07XG4gICAqICAgICB9LFxuICAgKiAgICAgZGVzZXJpYWxpemU6IGZ1bmN0aW9uIChvcGNvZGUsIHZhbHVlLCBleHRyYXMpIHtcbiAgICogICAgICAgcmV0dXJuIHsgdmFsdWU6IHZhbHVlLCBleHRyYXM6IGV4dHJhcyB9O1xuICAgKiAgICAgfVxuICAgKiAgIH07XG4gICAqICAgfn5+flxuICAgKlxuICAgKiBPciBvcHRpb25zIGZvciB0aGUgc2VydmVycyBpbmNsdWRpbmc6XG4gICAqICogYHVzZXJuYW1lYCBhbmQgYHBhc3N3b3JkYCBmb3IgZmFsbGJhY2sgU0FTTCBhdXRoZW50aWNhdGlvbiBjcmVkZW50aWFscy5cbiAgICogKiBgdGltZW91dGAgaW4gc2Vjb25kcyB0byBkZXRlcm1pbmUgZmFpbHVyZSBmb3Igb3BlcmF0aW9ucy4gRGVmYXVsdCBpcyAwLjVcbiAgICogICAgICAgICAgICAgc2Vjb25kcy5cbiAgICogKiAnY29ubnRpbWVvdXQnIGluIHNlY29uZHMgdG8gY29ubmVjdGlvbiBmYWlsdXJlLiBEZWZhdWx0IGlzIHR3aWNlIHRoZSB2YWx1ZVxuICAgKiAgICAgICAgICAgICAgICAgb2YgYHRpbWVvdXRgLlxuICAgKiAqIGBrZWVwQWxpdmVgIHdoZXRoZXIgdG8gZW5hYmxlIGtlZXAtYWxpdmUgZnVuY3Rpb25hbGl0eS4gRGVmYXVsdHMgdG8gZmFsc2UuXG4gICAqICogYGtlZXBBbGl2ZURlbGF5YCBpbiBzZWNvbmRzIHRvIHRoZSBpbml0aWFsIGRlbGF5IGJlZm9yZSB0aGUgZmlyc3Qga2VlcGFsaXZlXG4gICAqICAgICAgICAgICAgICAgICAgICBwcm9iZSBpcyBzZW50IG9uIGFuIGlkbGUgc29ja2V0LiBEZWZhdWx0cyBpcyAzMCBzZWNvbmRzLlxuICAgKiAqIGBrZXlUb1NlcnZlckhhc2hGdW5jdGlvbmAgYSBmdW5jdGlvbiB0byBtYXAga2V5cyB0byBzZXJ2ZXJzLCB3aXRoIHRoZSBzaWduYXR1cmVcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgKHNlcnZlcktleXM6IHN0cmluZ1tdLCBrZXk6IHN0cmluZyk6IHN0cmluZ1xuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBOT1RFOiBpZiB5b3UgbmVlZCB0byBkbyBzb21lIGV4cGVuc2l2ZSBpbml0aWFsaXphdGlvbiwgKnBsZWFzZSogZG8gaXQgbGF6aWx5IHRoZSBmaXJzdCB0aW1lIHlvdSB0aGlzIGZ1bmN0aW9uIGlzIGNhbGxlZCB3aXRoIGFuIGFycmF5IG9mIHNlcnZlcktleXMsIG5vdCBvbiBldmVyeSBjYWxsXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlPFZhbHVlLCBFeHRyYXM+KFxuICAgIHNlcnZlcnNTdHI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICBvcHRpb25zOiBJZkJ1ZmZlcjxcbiAgICAgIFZhbHVlLFxuICAgICAgRXh0cmFzLFxuICAgICAgdW5kZWZpbmVkIHwgKFBhcnRpYWw8U2VydmVyT3B0aW9ucz4gJiBHaXZlbkNsaWVudE9wdGlvbnM8VmFsdWUsIEV4dHJhcz4pLFxuICAgICAgUGFydGlhbDxTZXJ2ZXJPcHRpb25zPiAmIEdpdmVuQ2xpZW50T3B0aW9uczxWYWx1ZSwgRXh0cmFzPlxuICAgID5cbiAgKTogQ2xpZW50PFZhbHVlLCBFeHRyYXM+IHtcbiAgICBzZXJ2ZXJzU3RyID1cbiAgICAgIHNlcnZlcnNTdHIgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hJRVJfU0VSVkVSUyB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSEVfU0VSVkVSUyB8fFxuICAgICAgXCJsb2NhbGhvc3Q6MTEyMTFcIjtcbiAgICBjb25zdCBzZXJ2ZXJVcmlzID0gc2VydmVyc1N0ci5zcGxpdChcIixcIik7XG4gICAgY29uc3Qgc2VydmVycyA9IHNlcnZlclVyaXMubWFwKGZ1bmN0aW9uICh1cmkpIHtcbiAgICAgIGNvbnN0IHVyaVBhcnRzID0gdXJpLnNwbGl0KFwiQFwiKTtcbiAgICAgIGNvbnN0IGhvc3RQb3J0ID0gdXJpUGFydHNbdXJpUGFydHMubGVuZ3RoIC0gMV0uc3BsaXQoXCI6XCIpO1xuICAgICAgY29uc3QgdXNlclBhc3MgPSAodXJpUGFydHNbdXJpUGFydHMubGVuZ3RoIC0gMl0gfHwgXCJcIikuc3BsaXQoXCI6XCIpO1xuICAgICAgcmV0dXJuIG5ldyBTZXJ2ZXIoXG4gICAgICAgIGhvc3RQb3J0WzBdLFxuICAgICAgICBwYXJzZUludChob3N0UG9ydFsxXSB8fCBcIjExMjExXCIsIDEwKSxcbiAgICAgICAgdXNlclBhc3NbMF0sXG4gICAgICAgIHVzZXJQYXNzWzFdLFxuICAgICAgICBvcHRpb25zXG4gICAgICApO1xuICAgIH0pO1xuICAgIHJldHVybiBuZXcgQ2xpZW50KHNlcnZlcnMsIG9wdGlvbnMgYXMgYW55KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHaXZlbiBhIHNlcnZlcktleSBmcm9tbG9va3VwS2V5VG9TZXJ2ZXJLZXksIHJldHVybiB0aGUgY29ycmVzcG9uZGluZyBTZXJ2ZXIgaW5zdGFuY2VcbiAgICpcbiAgICogQHBhcmFtICB7c3RyaW5nfSBzZXJ2ZXJLZXlcbiAgICogQHJldHVybnMge1NlcnZlcn1cbiAgICovXG4gIHNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleTogc3RyaW5nKTogU2VydmVyIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2ZXJNYXBbc2VydmVyS2V5XTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHaXZlbiBhIGtleSB0byBsb29rIHVwIGluIG1lbWNhY2hlLCByZXR1cm4gYSBzZXJ2ZXJLZXkgKGJhc2VkIG9uIHNvbWVcbiAgICogaGFzaGluZyBmdW5jdGlvbikgd2hpY2ggY2FuIGJlIHVzZWQgdG8gaW5kZXggdGhpcy5zZXJ2ZXJNYXBcbiAgICovXG4gIGxvb2t1cEtleVRvU2VydmVyS2V5KGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLmtleVRvU2VydmVySGFzaEZ1bmN0aW9uKHRoaXMuc2VydmVyS2V5cywga2V5KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIHZhbHVlIGF0IHRoZSBnaXZlbiBrZXkgaW4gbWVtY2FjaGUuXG4gICAqL1xuICBhc3luYyBnZXQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPEdldFJlc3VsdDxWYWx1ZSwgRXh0cmFzPiB8IG51bGw+IHtcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoY29uc3RhbnRzLk9QX0dFVCwga2V5LCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIGNvbnN0IGRlc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5kZXNlcmlhbGl6ZShcbiAgICAgICAgICByZXNwb25zZS5oZWFkZXIub3Bjb2RlLFxuICAgICAgICAgIHJlc3BvbnNlLnZhbCxcbiAgICAgICAgICByZXNwb25zZS5leHRyYXNcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIHsgLi4uZGVzZXJpYWxpemVkLCBjYXM6IHJlc3BvbnNlLmhlYWRlci5jYXMgfTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiR0VUXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBCdWlsZCBhIHBpcGVsaW5lZCBnZXQgbXVsdGkgcmVxdWVzdCBieSBzZW5kaW5nIG9uZSBHRVRLUSBmb3IgZWFjaCBrZXkgKHF1aWV0LCBtZWFuaW5nIGl0IHdvbid0IHJlc3BvbmQgaWYgdGhlIHZhbHVlIGlzIG1pc3NpbmcpIGZvbGxvd2VkIGJ5IGEgbm8tb3AgdG8gZm9yY2UgYSByZXNwb25zZSAoYW5kIHRvIGdpdmUgdXMgYSBzZW50aW5lbCByZXNwb25zZSB0aGF0IHRoZSBwaXBlbGluZSBpcyBkb25lKVxuICAgKlxuICAgKiBjZiBodHRwczovL2dpdGh1Yi5jb20vY291Y2hiYXNlL21lbWNhY2hlZC9ibG9iL21hc3Rlci9kb2NzL0JpbmFyeVByb3RvY29sLm1kIzB4MGQtZ2V0a3EtZ2V0LXdpdGgta2V5LXF1aWV0bHlcbiAgICovXG4gIF9idWlsZEdldE11bHRpUmVxdWVzdChrZXlzOiBzdHJpbmdbXSwgc2VxOiBudW1iZXIpOiBCdWZmZXIge1xuICAgIC8vIHN0YXJ0IGF0IDI0IGZvciB0aGUgbm8tb3AgY29tbWFuZCBhdCB0aGUgZW5kXG4gICAgbGV0IHJlcXVlc3RTaXplID0gMjQ7XG4gICAgZm9yIChjb25zdCBrZXlJZHggaW4ga2V5cykge1xuICAgICAgcmVxdWVzdFNpemUgKz0gQnVmZmVyLmJ5dGVMZW5ndGgoa2V5c1trZXlJZHhdLCBcInV0ZjhcIikgKyAyNDtcbiAgICB9XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gQnVmZmVyLmFsbG9jKHJlcXVlc3RTaXplKTtcblxuICAgIGxldCBieXRlc1dyaXR0ZW4gPSAwO1xuICAgIGZvciAoY29uc3Qga2V5SWR4IGluIGtleXMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGtleXNba2V5SWR4XTtcbiAgICAgIGJ5dGVzV3JpdHRlbiArPSBjb3B5SW50b1JlcXVlc3RCdWZmZXIoXG4gICAgICAgIGNvbnN0YW50cy5PUF9HRVRLUSxcbiAgICAgICAga2V5LFxuICAgICAgICBcIlwiLFxuICAgICAgICBcIlwiLFxuICAgICAgICBzZXEsXG4gICAgICAgIHJlcXVlc3QsXG4gICAgICAgIGJ5dGVzV3JpdHRlblxuICAgICAgKTtcbiAgICB9XG5cbiAgICBieXRlc1dyaXR0ZW4gKz0gY29weUludG9SZXF1ZXN0QnVmZmVyKFxuICAgICAgY29uc3RhbnRzLk9QX05PX09QLFxuICAgICAgXCJcIixcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiLFxuICAgICAgc2VxLFxuICAgICAgcmVxdWVzdCxcbiAgICAgIGJ5dGVzV3JpdHRlblxuICAgICk7XG5cbiAgICByZXR1cm4gcmVxdWVzdDtcbiAgfVxuXG4gIC8qKiBFeGVjdXRpbmcgYSBwaXBlbGluZWQgKG11bHRpKSBnZXQgYWdhaW5zdCBhIHNpbmdsZSBzZXJ2ZXIuIFRoaXMgaXMgYSBwcml2YXRlIGltcGxlbWVudGF0aW9uIGRldGFpbCBvZiBnZXRNdWx0aS4gKi9cbiAgYXN5bmMgX2dldE11bHRpVG9TZXJ2ZXI8S2V5cyBleHRlbmRzIHN0cmluZz4oXG4gICAgc2VydjogU2VydmVyLFxuICAgIGtleXM6IEtleXNbXVxuICApOiBQcm9taXNlPEdldE11bHRpUmVzdWx0PEtleXMsIFZhbHVlLCBFeHRyYXM+PiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlTWFwOiBHZXRNdWx0aVJlc3VsdDxzdHJpbmcsIFZhbHVlLCBFeHRyYXM+ID0ge307XG5cbiAgICAgIGNvbnN0IGhhbmRsZTogT25SZXNwb25zZUNhbGxiYWNrID0gKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgZ2V0IHRoZSBuby1vcCByZXNwb25zZSwgd2UgYXJlIGRvbmUgd2l0aCB0aGlzIG9uZSBnZXRNdWx0aSBpbiB0aGUgcGVyLWJhY2tlbmQgZmFuLW91dFxuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IGNvbnN0YW50cy5PUF9OT19PUCkge1xuICAgICAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgdGhlIGhhbmRsZXIgd2lsbCBiZSBkZWxldGVkIGZyb20gdGhlIHJlc3BvbnNlQ2FsbGJhY2tzIG1hcCBpbiBzZXJ2ZXIuanNcbiAgICAgICAgICAgICAgLy8gVGhpcyBpc24ndCB0ZWNobmljYWxseSBuZWVkZWQgaGVyZSBiZWNhdXNlIHRoZSBsb2dpYyBpbiBzZXJ2ZXIuanMgYWxzbyBjaGVja3MgaWYgdG90YWxCb2R5TGVuZ3RoID09PSAwLCBidXQgb3VyIHVuaXR0ZXN0cyBhcmVuJ3QgZ3JlYXQgYWJvdXQgc2V0dGluZyB0aGF0IGZpZWxkLCBhbmQgYWxzbyB0aGlzIG1ha2VzIGl0IG1vcmUgZXhwbGljaXRcbiAgICAgICAgICAgICAgaGFuZGxlLnF1aWV0ID0gZmFsc2U7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2VNYXApO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLm9wY29kZSA9PT0gY29uc3RhbnRzLk9QX0dFVEsgfHxcbiAgICAgICAgICAgICAgcmVzcG9uc2UuaGVhZGVyLm9wY29kZSA9PT0gY29uc3RhbnRzLk9QX0dFVEtRXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgY29uc3QgZGVzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLmRlc2VyaWFsaXplKFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmhlYWRlci5vcGNvZGUsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2UudmFsLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmV4dHJhc1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBjb25zdCBrZXkgPSByZXNwb25zZS5rZXkudG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgaWYgKGtleS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgICAgICBcIlJlY2lldmVkIGVtcHR5IGtleSBpbiBnZXRNdWx0aTogXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKVxuICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmVzcG9uc2VNYXBba2V5XSA9IHsgLi4uZGVzZXJpYWxpemVkLCBjYXM6IHJlc3BvbnNlLmhlYWRlci5jYXMgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgICAgXCJSZWNpZXZlZCByZXNwb25zZSBpbiBnZXRNdWx0aSBmb3IgdW5rbm93biBvcGNvZGU6IFwiICtcbiAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJHRVRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cylcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICAvLyBUaGlzIHByZXZlbnRzIHRoZSBoYW5kbGVyIGZyb20gYmVpbmcgZGVsZXRlZFxuICAgICAgLy8gYWZ0ZXIgdGhlIGZpcnN0IHJlc3BvbnNlLiBMb2dpYyBpbiBzZXJ2ZXIuanMuXG4gICAgICBoYW5kbGUucXVpZXQgPSB0cnVlO1xuXG4gICAgICBjb25zdCBzZXEgPSB0aGlzLmluY3JTZXEoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLl9idWlsZEdldE11bHRpUmVxdWVzdChrZXlzLCBzZXEpO1xuICAgICAgc2Vydi5vblJlc3BvbnNlKHRoaXMuc2VxLCBoYW5kbGUpO1xuICAgICAgc2Vydi5vbkVycm9yKHRoaXMuc2VxLCByZWplY3QpO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2cyB0aGUgdmFsdWUgYXQgdGhlIGdpdmVuIGtleXMgaW4gbWVtY2FjaGVkLiBSZXR1cm5zIGEgbWFwIGZyb20gdGhlXG4gICAqIHJlcXVlc3RlZCBrZXlzIHRvIHJlc3VsdHMsIG9yIG51bGwgaWYgdGhlIGtleSB3YXMgbm90IGZvdW5kLlxuICAgKi9cbiAgYXN5bmMgZ2V0TXVsdGk8S2V5cyBleHRlbmRzIHN0cmluZz4oXG4gICAga2V5czogS2V5c1tdXG4gICk6IFByb21pc2U8R2V0TXVsdGlSZXN1bHQ8S2V5cywgVmFsdWUsIEV4dHJhcz4+IHtcbiAgICBjb25zdCBzZXJ2ZXJLZXl0b0xvb2t1cEtleXM6IHtcbiAgICAgIFtzZXJ2ZXJLZXk6IHN0cmluZ106IHN0cmluZ1tdO1xuICAgIH0gPSB7fTtcbiAgICBrZXlzLmZvckVhY2goKGxvb2t1cEtleSkgPT4ge1xuICAgICAgY29uc3Qgc2VydmVyS2V5ID0gdGhpcy5sb29rdXBLZXlUb1NlcnZlcktleShsb29rdXBLZXkpO1xuICAgICAgaWYgKCFzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSkge1xuICAgICAgICBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSA9IFtdO1xuICAgICAgfVxuICAgICAgc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV0ucHVzaChsb29rdXBLZXkpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlZFNlcnZlcktleXMgPSBPYmplY3Qua2V5cyhzZXJ2ZXJLZXl0b0xvb2t1cEtleXMpO1xuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIHVzZWRTZXJ2ZXJLZXlzLm1hcCgoc2VydmVyS2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2VydmVyS2V5VG9TZXJ2ZXIoc2VydmVyS2V5KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldE11bHRpVG9TZXJ2ZXIoc2VydmVyLCBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSk7XG4gICAgICB9KVxuICAgICk7XG5cbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7fSwgLi4ucmVzdWx0cyk7XG4gIH1cblxuICBhc3luYyBnZXRNdWx0aVdpdGhFcnJvcnM8S2V5cyBleHRlbmRzIHN0cmluZz4oXG4gICAga2V5czogS2V5c1tdXG4gICk6IFByb21pc2U8R2V0TXVsdGlXaXRoRXJyb3JzUmVzdWx0PEtleXMsIFZhbHVlLCBFeHRyYXM+PiB7XG4gICAgY29uc3Qgc2VydmVyS2V5dG9Mb29rdXBLZXlzOiB7XG4gICAgICBbc2VydmVyS2V5OiBzdHJpbmddOiBLZXlzW107XG4gICAgfSA9IHt9O1xuICAgIGtleXMuZm9yRWFjaCgobG9va3VwS2V5KSA9PiB7XG4gICAgICBjb25zdCBzZXJ2ZXJLZXkgPSB0aGlzLmxvb2t1cEtleVRvU2VydmVyS2V5KGxvb2t1cEtleSk7XG4gICAgICBpZiAoIXNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldKSB7XG4gICAgICAgIHNlcnZlcktleXRvTG9va3VwS2V5c1tzZXJ2ZXJLZXldID0gW107XG4gICAgICB9XG4gICAgICBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XS5wdXNoKGxvb2t1cEtleSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCB1c2VkU2VydmVyS2V5cyA9IE9iamVjdC5rZXlzKHNlcnZlcktleXRvTG9va3VwS2V5cyk7XG4gICAgY29uc3QgZXJyb3JzOiBHZXRNdWx0aUVycm9yPEtleXM+W10gPSBbXTtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICB1c2VkU2VydmVyS2V5cy5tYXAoYXN5bmMgKHNlcnZlcktleSkgPT4ge1xuICAgICAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNlcnZlcktleVRvU2VydmVyKHNlcnZlcktleSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2dldE11bHRpVG9TZXJ2ZXIoc2VydmVyLCBzZXJ2ZXJLZXl0b0xvb2t1cEtleXNbc2VydmVyS2V5XSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGxldCBlcnJvcjogRXJyb3I7XG4gICAgICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICBlcnJvciA9IGVycjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoXCJVbmtub3duIEVycm9yXCIpO1xuICAgICAgICAgICAgKGVycm9yIGFzIGFueSkudGhyb3duID0gZXJyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVycm9ycy5wdXNoKHtcbiAgICAgICAgICAgIGVycm9yLFxuICAgICAgICAgICAgc2VydmVyS2V5LFxuICAgICAgICAgICAga2V5czogc2VydmVyS2V5dG9Mb29rdXBLZXlzW3NlcnZlcktleV1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgcmV0dXJuIHsgcmVzdWx0OiBPYmplY3QuYXNzaWduKHt9LCAuLi5yZXN1bHRzKSwgZXJyb3JzIH07XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBga2V5YCB0byBgdmFsdWVgLlxuICAgKi9cbiAgYXN5bmMgc2V0KFxuICAgIGtleTogc3RyaW5nLFxuICAgIHZhbHVlOiBWYWx1ZSxcbiAgICBvcHRpb25zPzogeyBleHBpcmVzPzogbnVtYmVyOyBjYXM/OiBDQVNUb2tlbiB9XG4gICk6IFByb21pc2U8Ym9vbGVhbiB8IG51bGw+IHtcbiAgICBjb25zdCBleHBpcmVzID0gb3B0aW9ucz8uZXhwaXJlcztcbiAgICBjb25zdCBjYXMgPSBvcHRpb25zPy5jYXM7XG5cbiAgICAvLyBUT0RPOiBzdXBwb3J0IGZsYWdzXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXhwaXJhdGlvbiA9IG1ha2VFeHBpcmF0aW9uKGV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXMpO1xuICAgIGNvbnN0IGV4dHJhcyA9IEJ1ZmZlci5jb25jYXQoW0J1ZmZlci5mcm9tKFwiMDAwMDAwMDBcIiwgXCJoZXhcIiksIGV4cGlyYXRpb25dKTtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLnNlcmlhbGl6ZShcbiAgICAgIGNvbnN0YW50cy5PUF9TRVQsXG4gICAgICB2YWx1ZSxcbiAgICAgIGV4dHJhc1xuICAgICk7XG4gICAgY29uc3QgcmVxdWVzdCA9IFV0aWxzLmVuY29kZVJlcXVlc3Qoe1xuICAgICAgaGVhZGVyOiB7XG4gICAgICAgIG9wY29kZTogY29uc3RhbnRzLk9QX1NFVCxcbiAgICAgICAgb3BhcXVlOiB0aGlzLnNlcSxcbiAgICAgICAgY2FzLFxuICAgICAgfSxcbiAgICAgIGtleSxcbiAgICAgIHZhbHVlOiBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgZXh0cmFzOiBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICB9KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9FWElTVFM6XG4gICAgICAgIGlmIChjYXMpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlNFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICAgICAgfVxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlNFVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQUREXG4gICAqXG4gICAqIEFkZHMgdGhlIGdpdmVuIF9rZXlfIGFuZCBfdmFsdWVfIHRvIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHNcbiAgICogaWYgdGhlIGtleSBpcyBub3QgYWxyZWFkeSBzZXQuXG4gICAqXG4gICAqIFRoZSBvcHRpb25zIGRpY3Rpb25hcnkgdGFrZXM6XG4gICAqICogX2V4cGlyZXNfOiBvdmVycmlkZXMgdGhlIGRlZmF1bHQgZXhwaXJhdGlvbiAoc2VlIGBDbGllbnQuY3JlYXRlYCkgZm9yIHRoaXNcbiAgICogICAgICAgICAgICAgIHBhcnRpY3VsYXIga2V5LXZhbHVlIHBhaXIuXG4gICAqL1xuICBhc3luYyBhZGQoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdmFsdWU6IFZhbHVlLFxuICAgIG9wdGlvbnM/OiB7IGV4cGlyZXM/OiBudW1iZXIgfVxuICApOiBQcm9taXNlPGJvb2xlYW4gfCBudWxsPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCBmbGFncywgc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgZXhwaXJhdGlvbiA9IG1ha2VFeHBpcmF0aW9uKG9wdGlvbnM/LmV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXMpO1xuICAgIGNvbnN0IGV4dHJhcyA9IEJ1ZmZlci5jb25jYXQoW0J1ZmZlci5mcm9tKFwiMDAwMDAwMDBcIiwgXCJoZXhcIiksIGV4cGlyYXRpb25dKTtcblxuICAgIGNvbnN0IG9wY29kZSA9IGNvbnN0YW50cy5PUF9BREQ7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUob3Bjb2RlLCB2YWx1ZSwgZXh0cmFzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoXG4gICAgICBvcGNvZGUsXG4gICAgICBrZXksXG4gICAgICBzZXJpYWxpemVkLmV4dHJhcyxcbiAgICAgIHNlcmlhbGl6ZWQudmFsdWUsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5LRVlfRVhJU1RTOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkFERFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIGdpdmVuIF9rZXlfIGFuZCBfdmFsdWVfIHRvIG1lbWNhY2hlLiBUaGUgb3BlcmF0aW9uIG9ubHkgc3VjY2VlZHNcbiAgICogaWYgdGhlIGtleSBpcyBhbHJlYWR5IHByZXNlbnQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHZhbHVlOiBWYWx1ZSxcbiAgICBvcHRpb25zPzogeyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTxib29sZWFuIHwgbnVsbD4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgZmxhZ3MsIHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBtYWtlRXhwaXJhdGlvbihvcHRpb25zPy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCBleHRyYXMgPSBCdWZmZXIuY29uY2F0KFtCdWZmZXIuZnJvbShcIjAwMDAwMDAwXCIsIFwiaGV4XCIpLCBleHBpcmF0aW9uXSk7XG5cbiAgICBjb25zdCBvcGNvZGU6IGNvbnN0YW50cy5PUCA9IGNvbnN0YW50cy5PUF9SRVBMQUNFO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIGV4dHJhcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlJFUExBQ0VcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGhlIGdpdmVuIF9rZXlfIGZyb20gbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkc1xuICAgKiBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IFN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcig0LCBrZXksIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcblxuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIkRFTEVURVwiLCByZXNwb25zZT8uaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluY3JlbWVudHMgdGhlIGdpdmVuIF9rZXlfIGluIG1lbWNhY2hlLlxuICAgKi9cbiAgYXN5bmMgaW5jcmVtZW50KFxuICAgIGtleTogc3RyaW5nLFxuICAgIGFtb3VudDogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiB7IGluaXRpYWw/OiBudW1iZXI7IGV4cGlyZXM/OiBudW1iZXIgfVxuICApOiBQcm9taXNlPHsgdmFsdWU6IG51bWJlciB8IG51bGw7IHN1Y2Nlc3M6IGJvb2xlYW4gfCBudWxsIH0+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBpbml0aWFsID0gb3B0aW9ucz8uaW5pdGlhbCB8fCAwO1xuICAgIGNvbnN0IGV4cGlyZXMgPSBvcHRpb25zPy5leHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzO1xuICAgIGNvbnN0IGV4dHJhcyA9IG1ha2VBbW91bnRJbml0aWFsQW5kRXhwaXJhdGlvbihhbW91bnQsIGluaXRpYWwsIGV4cGlyZXMpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIGNvbnN0YW50cy5PUF9JTkNSRU1FTlQsXG4gICAgICBrZXksXG4gICAgICBleHRyYXMsXG4gICAgICBcIlwiLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICBjb25zdCBidWZJbnQgPVxuICAgICAgICAgIChyZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDApIDw8IDgpICsgcmVzcG9uc2UudmFsLnJlYWRVSW50MzJCRSg0KTtcbiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJ1ZkludCwgc3VjY2VzczogdHJ1ZSB9O1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIklOQ1JFTUVOVFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVjcmVtZW50cyB0aGUgZ2l2ZW4gYGtleWAgaW4gbWVtY2FjaGUuXG4gICAqL1xuICBhc3luYyBkZWNyZW1lbnQoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYW1vdW50OiBudW1iZXIsXG4gICAgb3B0aW9uczogeyBpbml0aWFsPzogbnVtYmVyOyBleHBpcmVzPzogbnVtYmVyIH1cbiAgKTogUHJvbWlzZTx7IHZhbHVlOiBudW1iZXIgfCBudWxsOyBzdWNjZXNzOiBib29sZWFuIHwgbnVsbCB9PiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3QgaW5pdGlhbCA9IG9wdGlvbnMuaW5pdGlhbCB8fCAwO1xuICAgIGNvbnN0IGV4cGlyZXMgPSBvcHRpb25zLmV4cGlyZXMgfHwgdGhpcy5vcHRpb25zLmV4cGlyZXM7XG4gICAgY29uc3QgZXh0cmFzID0gbWFrZUFtb3VudEluaXRpYWxBbmRFeHBpcmF0aW9uKGFtb3VudCwgaW5pdGlhbCwgZXhwaXJlcyk7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgY29uc3RhbnRzLk9QX0RFQ1JFTUVOVCxcbiAgICAgIGtleSxcbiAgICAgIGV4dHJhcyxcbiAgICAgIFwiXCIsXG4gICAgICB0aGlzLnNlcVxuICAgICk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBlcmZvcm0oa2V5LCByZXF1ZXN0LCB0aGlzLnNlcSk7XG4gICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgIGNvbnN0IGJ1ZkludCA9XG4gICAgICAgICAgKHJlc3BvbnNlLnZhbC5yZWFkVUludDMyQkUoMCkgPDwgOCkgKyByZXNwb25zZS52YWwucmVhZFVJbnQzMkJFKDQpO1xuICAgICAgICByZXR1cm4geyB2YWx1ZTogYnVmSW50LCBzdWNjZXNzOiB0cnVlIH07XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUFuZExvZ0Vycm9yKFwiREVDUkVNRU5UXCIsIHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIGdpdmVuIF92YWx1ZV8gdG8gdGhlIHZhbHVlIGFzc29jaWF0ZWQgd2l0aCB0aGUgZ2l2ZW4gX2tleV8gaW5cbiAgICogbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkcyBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGFwcGVuZChrZXk6IHN0cmluZywgdmFsdWU6IFZhbHVlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgLy8gVE9ETzogc3VwcG9ydCB2ZXJzaW9uIChDQVMpXG4gICAgdGhpcy5pbmNyU2VxKCk7XG4gICAgY29uc3Qgb3Bjb2RlOiBjb25zdGFudHMuT1AgPSBjb25zdGFudHMuT1BfQVBQRU5EO1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZXIuc2VyaWFsaXplKG9wY29kZSwgdmFsdWUsIFwiXCIpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgIG9wY29kZSxcbiAgICAgIGtleSxcbiAgICAgIHNlcmlhbGl6ZWQuZXh0cmFzLFxuICAgICAgc2VyaWFsaXplZC52YWx1ZSxcbiAgICAgIHRoaXMuc2VxXG4gICAgKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJBUFBFTkRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByZXBlbmQgdGhlIGdpdmVuIF92YWx1ZV8gdG8gdGhlIHZhbHVlIGFzc29jaWF0ZWQgd2l0aCB0aGUgZ2l2ZW4gX2tleV8gaW5cbiAgICogbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkcyBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIHByZXBlbmQoa2V5OiBzdHJpbmcsIHZhbHVlOiBWYWx1ZSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIFRPRE86IHN1cHBvcnQgdmVyc2lvbiAoQ0FTKVxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IG9wY29kZTogY29uc3RhbnRzLk9QID0gY29uc3RhbnRzLk9QX1BSRVBFTkQ7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHRoaXMuc2VyaWFsaXplci5zZXJpYWxpemUob3Bjb2RlLCB2YWx1ZSwgXCJcIik7XG4gICAgY29uc3QgcmVxdWVzdCA9IG1ha2VSZXF1ZXN0QnVmZmVyKFxuICAgICAgb3Bjb2RlLFxuICAgICAga2V5LFxuICAgICAgc2VyaWFsaXplZC5leHRyYXMsXG4gICAgICBzZXJpYWxpemVkLnZhbHVlLFxuICAgICAgdGhpcy5zZXFcbiAgICApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wZXJmb3JtKGtleSwgcmVxdWVzdCwgdGhpcy5zZXEpO1xuICAgIHN3aXRjaCAocmVzcG9uc2UuaGVhZGVyLnN0YXR1cykge1xuICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuS0VZX05PVF9GT1VORDpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlBSRVBFTkRcIiwgcmVzcG9uc2UuaGVhZGVyLnN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRvdWNoIHNldHMgYW4gZXhwaXJhdGlvbiB2YWx1ZSwgZ2l2ZW4gYnkgX2V4cGlyZXNfLCBvbiB0aGUgZ2l2ZW4gX2tleV8gaW5cbiAgICogbWVtY2FjaGUuIFRoZSBvcGVyYXRpb24gb25seSBzdWNjZWVkcyBpZiB0aGUga2V5IGlzIGFscmVhZHkgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIHRvdWNoKGtleTogc3RyaW5nLCBleHBpcmVzOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAvLyBUT0RPOiBzdXBwb3J0IHZlcnNpb24gKENBUylcbiAgICB0aGlzLmluY3JTZXEoKTtcbiAgICBjb25zdCBleHRyYXMgPSBtYWtlRXhwaXJhdGlvbihleHBpcmVzIHx8IHRoaXMub3B0aW9ucy5leHBpcmVzKTtcbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgxYywga2V5LCBleHRyYXMsIFwiXCIsIHRoaXMuc2VxKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucGVyZm9ybShrZXksIHJlcXVlc3QsIHRoaXMuc2VxKTtcbiAgICBzd2l0Y2ggKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgIGNhc2UgUmVzcG9uc2VTdGF0dXMuU1VDQ0VTUzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLktFWV9OT1RfRk9VTkQ6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoXCJUT1VDSFwiLCByZXNwb25zZS5oZWFkZXIuc3RhdHVzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRkxVU0hcbiAgICpcbiAgICogRmx1c2hlcyB0aGUgY2FjaGUgb24gZWFjaCBjb25uZWN0ZWQgc2VydmVyLiBUaGUgY2FsbGJhY2sgc2lnbmF0dXJlIGlzOlxuICAgKlxuICAgKiAgICAgY2FsbGJhY2sobGFzdEVyciwgcmVzdWx0cylcbiAgICpcbiAgICogd2hlcmUgX2xhc3RFcnJfIGlzIHRoZSBsYXN0IGVycm9yIGVuY291bnRlcmVkIChvciBudWxsLCBpbiB0aGUgY29tbW9uIGNhc2VcbiAgICogb2Ygbm8gZXJyb3JzKS4gX3Jlc3VsdHNfIGlzIGEgZGljdGlvbmFyeSBtYXBwaW5nIGBcImhvc3RuYW1lOnBvcnRcImAgdG8gZWl0aGVyXG4gICAqIGB0cnVlYCAoaWYgdGhlIG9wZXJhdGlvbiB3YXMgc3VjY2Vzc2Z1bCksIG9yIGFuIGVycm9yLlxuICAgKiBAcGFyYW0gY2FsbGJhY2tcbiAgICovXG4gIGZsdXNoKCk6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IEVycm9yPj47XG4gIGZsdXNoKFxuICAgIGNhbGxiYWNrOiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHJlc3VsdHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj5cbiAgICApID0+IHZvaWRcbiAgKTogdm9pZDtcbiAgZmx1c2goXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHJlc3VsdHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj5cbiAgICApID0+IHZvaWRcbiAgKSB7XG4gICAgaWYgKGNhbGxiYWNrID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBwcm9taXNpZnkoKGNhbGxiYWNrKSA9PiB7XG4gICAgICAgIHRoaXMuZmx1c2goZnVuY3Rpb24gKGVyciwgcmVzdWx0cykge1xuICAgICAgICAgIGNhbGxiYWNrKGVyciwgcmVzdWx0cyk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIC8vIFRPRE86IHN1cHBvcnQgZXhwaXJhdGlvblxuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDA4LCBcIlwiLCBcIlwiLCBcIlwiLCB0aGlzLnNlcSk7XG4gICAgbGV0IGNvdW50ID0gdGhpcy5zZXJ2ZXJzLmxlbmd0aDtcbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBFcnJvcj4gPSB7fTtcbiAgICBsZXQgbGFzdEVycjogRXJyb3IgfCBudWxsID0gbnVsbDtcblxuICAgIGNvbnN0IGhhbmRsZUZsdXNoID0gZnVuY3Rpb24gKHNlcTogbnVtYmVyLCBzZXJ2OiBTZXJ2ZXIpIHtcbiAgICAgIHNlcnYub25SZXNwb25zZShzZXEsIGZ1bmN0aW9uICgvKiByZXNwb25zZSAqLykge1xuICAgICAgICBjb3VudCAtPSAxO1xuICAgICAgICByZXN1bHRbc2Vydi5ob3N0cG9ydFN0cmluZygpXSA9IHRydWU7XG4gICAgICAgIGlmIChjYWxsYmFjayAmJiBjb3VudCA9PT0gMCkge1xuICAgICAgICAgIGNhbGxiYWNrKGxhc3RFcnIsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgc2Vydi5vbkVycm9yKHNlcSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICBjb3VudCAtPSAxO1xuICAgICAgICBsYXN0RXJyID0gZXJyO1xuICAgICAgICByZXN1bHRbc2Vydi5ob3N0cG9ydFN0cmluZygpXSA9IGVycjtcbiAgICAgICAgaWYgKGNhbGxiYWNrICYmIGNvdW50ID09PSAwKSB7XG4gICAgICAgICAgY2FsbGJhY2sobGFzdEVyciwgcmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBzZXJ2LndyaXRlKHJlcXVlc3QpO1xuICAgIH07XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlRmx1c2godGhpcy5zZXEsIHRoaXMuc2VydmVyc1tpXSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNUQVRTX1dJVEhfS0VZXG4gICAqXG4gICAqIFNlbmRzIGEgbWVtY2FjaGUgc3RhdHMgY29tbWFuZCB3aXRoIGEga2V5IHRvIGVhY2ggY29ubmVjdGVkIHNlcnZlci4gVGhlXG4gICAqIGNhbGxiYWNrIGlzIGludm9rZWQgKipPTkNFIFBFUiBTRVJWRVIqKiBhbmQgaGFzIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhlcnIsIHNlcnZlciwgc3RhdHMpXG4gICAqXG4gICAqIF9zZXJ2ZXJfIGlzIHRoZSBgXCJob3N0bmFtZTpwb3J0XCJgIG9mIHRoZSBzZXJ2ZXIsIGFuZCBfc3RhdHNfIGlzIGEgZGljdGlvbmFyeVxuICAgKiBtYXBwaW5nIHRoZSBzdGF0IG5hbWUgdG8gdGhlIHZhbHVlIG9mIHRoZSBzdGF0aXN0aWMgYXMgYSBzdHJpbmcuXG4gICAqIEBwYXJhbSBrZXlcbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICBzdGF0c1dpdGhLZXkoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgY2FsbGJhY2s/OiAoXG4gICAgICBlcnI6IEVycm9yIHwgbnVsbCxcbiAgICAgIHNlcnZlcjogc3RyaW5nLFxuICAgICAgc3RhdHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsXG4gICAgKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDEwLCBrZXksIFwiXCIsIFwiXCIsIHRoaXMuc2VxKTtcblxuICAgIGNvbnN0IGhhbmRsZVN0YXRzID0gKHNlcTogbnVtYmVyLCBzZXJ2OiBTZXJ2ZXIpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgICAgY29uc3QgaGFuZGxlOiBPblJlc3BvbnNlQ2FsbGJhY2sgPSAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgLy8gZW5kIG9mIHN0YXQgcmVzcG9uc2VzXG4gICAgICAgIGlmIChyZXNwb25zZS5oZWFkZXIudG90YWxCb2R5TGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBzZXJ2Lmhvc3Rwb3J0U3RyaW5nKCksIHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyBwcm9jZXNzIHNpbmdsZSBzdGF0IGxpbmUgcmVzcG9uc2VcbiAgICAgICAgc3dpdGNoIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzKSB7XG4gICAgICAgICAgY2FzZSBSZXNwb25zZVN0YXR1cy5TVUNDRVNTOlxuICAgICAgICAgICAgcmVzdWx0W3Jlc3BvbnNlLmtleS50b1N0cmluZygpXSA9IHJlc3BvbnNlLnZhbC50b1N0cmluZygpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5oYW5kbGVSZXNwb25zZUVycm9yKFxuICAgICAgICAgICAgICBgU1RBVFMgKCR7a2V5fSlgLFxuICAgICAgICAgICAgICByZXNwb25zZS5oZWFkZXIuc3RhdHVzLFxuICAgICAgICAgICAgICB1bmRlZmluZWRcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgY2FsbGJhY2soZXJyb3IsIHNlcnYuaG9zdHBvcnRTdHJpbmcoKSwgbnVsbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBoYW5kbGUucXVpZXQgPSB0cnVlO1xuXG4gICAgICBzZXJ2Lm9uUmVzcG9uc2Uoc2VxLCBoYW5kbGUpO1xuICAgICAgc2Vydi5vbkVycm9yKHNlcSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnIsIHNlcnYuaG9zdHBvcnRTdHJpbmcoKSwgbnVsbCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgc2Vydi53cml0ZShyZXF1ZXN0KTtcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGhhbmRsZVN0YXRzKHRoaXMuc2VxLCB0aGlzLnNlcnZlcnNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTVEFUU1xuICAgKlxuICAgKiBGZXRjaGVzIG1lbWNhY2hlIHN0YXRzIGZyb20gZWFjaCBjb25uZWN0ZWQgc2VydmVyLiBUaGUgY2FsbGJhY2sgaXMgaW52b2tlZFxuICAgKiAqKk9OQ0UgUEVSIFNFUlZFUioqIGFuZCBoYXMgdGhlIHNpZ25hdHVyZTpcbiAgICpcbiAgICogICAgIGNhbGxiYWNrKGVyciwgc2VydmVyLCBzdGF0cylcbiAgICpcbiAgICogX3NlcnZlcl8gaXMgdGhlIGBcImhvc3RuYW1lOnBvcnRcImAgb2YgdGhlIHNlcnZlciwgYW5kIF9zdGF0c18gaXMgYVxuICAgKiBkaWN0aW9uYXJ5IG1hcHBpbmcgdGhlIHN0YXQgbmFtZSB0byB0aGUgdmFsdWUgb2YgdGhlIHN0YXRpc3RpYyBhcyBhIHN0cmluZy5cbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICBzdGF0cyhcbiAgICBjYWxsYmFjaz86IChcbiAgICAgIGVycjogRXJyb3IgfCBudWxsLFxuICAgICAgc2VydmVyOiBzdHJpbmcsXG4gICAgICBzdGF0czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IG51bGxcbiAgICApID0+IHZvaWRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0c1dpdGhLZXkoXCJcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgLyoqXG4gICAqIFJFU0VUX1NUQVRTXG4gICAqXG4gICAqIFJlc2V0IHRoZSBzdGF0aXN0aWNzIGVhY2ggc2VydmVyIGlzIGtlZXBpbmcgYmFjayB0byB6ZXJvLiBUaGlzIGRvZXNuJ3QgY2xlYXJcbiAgICogc3RhdHMgc3VjaCBhcyBpdGVtIGNvdW50LCBidXQgdGVtcG9yYXJ5IHN0YXRzIHN1Y2ggYXMgdG90YWwgbnVtYmVyIG9mXG4gICAqIGNvbm5lY3Rpb25zIG92ZXIgdGltZS5cbiAgICpcbiAgICogVGhlIGNhbGxiYWNrIGlzIGludm9rZWQgKipPTkNFIFBFUiBTRVJWRVIqKiBhbmQgaGFzIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqICAgICBjYWxsYmFjayhlcnIsIHNlcnZlcilcbiAgICpcbiAgICogX3NlcnZlcl8gaXMgdGhlIGBcImhvc3RuYW1lOnBvcnRcImAgb2YgdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIGNhbGxiYWNrXG4gICAqL1xuICByZXNldFN0YXRzKFxuICAgIGNhbGxiYWNrPzogKFxuICAgICAgZXJyOiBFcnJvciB8IG51bGwsXG4gICAgICBzZXJ2ZXI6IHN0cmluZyxcbiAgICAgIHN0YXRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbFxuICAgICkgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICB0aGlzLnN0YXRzV2l0aEtleShcInJlc2V0XCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBRVUlUXG4gICAqXG4gICAqIENsb3NlcyB0aGUgY29ubmVjdGlvbiB0byBlYWNoIHNlcnZlciwgbm90aWZ5aW5nIHRoZW0gb2YgdGhpcyBpbnRlbnRpb24uIE5vdGVcbiAgICogdGhhdCBxdWl0IGNhbiByYWNlIGFnYWluc3QgYWxyZWFkeSBvdXRzdGFuZGluZyByZXF1ZXN0cyB3aGVuIHRob3NlIHJlcXVlc3RzXG4gICAqIGZhaWwgYW5kIGFyZSByZXRyaWVkLCBsZWFkaW5nIHRvIHRoZSBxdWl0IGNvbW1hbmQgd2lubmluZyBhbmQgY2xvc2luZyB0aGVcbiAgICogY29ubmVjdGlvbiBiZWZvcmUgdGhlIHJldHJpZXMgY29tcGxldGUuXG4gICAqL1xuICBxdWl0KCkge1xuICAgIHRoaXMuaW5jclNlcSgpO1xuICAgIC8vIFRPRE86IE5pY2VyIHBlcmhhcHMgdG8gZG8gUVVJVFEgKDB4MTcpIGJ1dCBuZWVkIGEgbmV3IGNhbGxiYWNrIGZvciB3aGVuXG4gICAgLy8gd3JpdGUgaXMgZG9uZS5cbiAgICBjb25zdCByZXF1ZXN0ID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgwNywgXCJcIiwgXCJcIiwgXCJcIiwgdGhpcy5zZXEpOyAvLyBRVUlUXG4gICAgbGV0IHNlcnY7XG5cbiAgICBjb25zdCBoYW5kbGVRdWl0ID0gZnVuY3Rpb24gKHNlcTogbnVtYmVyLCBzZXJ2OiBTZXJ2ZXIpIHtcbiAgICAgIHNlcnYub25SZXNwb25zZShzZXEsIGZ1bmN0aW9uICgvKiByZXNwb25zZSAqLykge1xuICAgICAgICBzZXJ2LmNsb3NlKCk7XG4gICAgICB9KTtcbiAgICAgIHNlcnYub25FcnJvcihzZXEsIGZ1bmN0aW9uICgvKiBlcnIgKi8pIHtcbiAgICAgICAgc2Vydi5jbG9zZSgpO1xuICAgICAgfSk7XG4gICAgICBzZXJ2LndyaXRlKHJlcXVlc3QpO1xuICAgIH07XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgc2VydiA9IHRoaXMuc2VydmVyc1tpXTtcbiAgICAgIGhhbmRsZVF1aXQodGhpcy5zZXEsIHNlcnYpO1xuICAgIH1cbiAgfVxuXG4gIF92ZXJzaW9uKHNlcnZlcjogU2VydmVyKTogUHJvbWlzZTx7IHZhbHVlOiBWYWx1ZSB8IG51bGwgfT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLmluY3JTZXEoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBtYWtlUmVxdWVzdEJ1ZmZlcihcbiAgICAgICAgY29uc3RhbnRzLk9QX1ZFUlNJT04sXG4gICAgICAgIFwiXCIsXG4gICAgICAgIFwiXCIsXG4gICAgICAgIFwiXCIsXG4gICAgICAgIHRoaXMuc2VxXG4gICAgICApO1xuICAgICAgdGhpcy5wZXJmb3JtT25TZXJ2ZXIoc2VydmVyLCByZXF1ZXN0LCB0aGlzLnNlcSwgKGVyciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN3aXRjaCAocmVzcG9uc2UhLmhlYWRlci5zdGF0dXMpIHtcbiAgICAgICAgICBjYXNlIFJlc3BvbnNlU3RhdHVzLlNVQ0NFU1M6XG4gICAgICAgICAgICAvKiBUT0RPOiB0aGlzIGlzIGJ1Z2dlZCwgd2Ugc2hvdWxkJ3QgdXNlIHRoZSBkZXNlcmlhbGl6ZXIgaGVyZSwgc2luY2UgdmVyc2lvbiBhbHdheXMgcmV0dXJucyBhIHZlcnNpb24gc3RyaW5nLlxuICAgICAgICAgICAgIFRoZSBkZXNlcmlhbGl6ZXIgc2hvdWxkIG9ubHkgYmUgdXNlZCBvbiB1c2VyIGtleSBkYXRhLiAqL1xuICAgICAgICAgICAgY29uc3QgZGVzZXJpYWxpemVkID0gdGhpcy5zZXJpYWxpemVyLmRlc2VyaWFsaXplKFxuICAgICAgICAgICAgICByZXNwb25zZSEuaGVhZGVyLm9wY29kZSxcbiAgICAgICAgICAgICAgcmVzcG9uc2UhLnZhbCxcbiAgICAgICAgICAgICAgcmVzcG9uc2UhLmV4dHJhc1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJldHVybiByZXNvbHZlKHsgdmFsdWU6IGRlc2VyaWFsaXplZC52YWx1ZSB9KTtcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgdGhpcy5jcmVhdGVBbmRMb2dFcnJvcihcIlZFUlNJT05cIiwgcmVzcG9uc2UhLmhlYWRlci5zdGF0dXMpXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0IHRoZSBzZXJ2ZXIgdmVyc2lvbiBmcm9tIHRoZSBcImZpcnN0XCIgc2VydmVyIGluIHRoZSBiYWNrZW5kIHBvb2wuXG4gICAqIFRoZSBzZXJ2ZXIgcmVzcG9uZHMgd2l0aCBhIHBhY2tldCBjb250YWluaW5nIHRoZSB2ZXJzaW9uIHN0cmluZyBpbiB0aGUgYm9keSB3aXRoIHRoZSBmb2xsb3dpbmcgZm9ybWF0OiBcIngueS56XCJcbiAgICovXG4gIHZlcnNpb24oKTogUHJvbWlzZTx7IHZhbHVlOiBWYWx1ZSB8IG51bGwgfT4ge1xuICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2VydmVyS2V5VG9TZXJ2ZXIodGhpcy5zZXJ2ZXJLZXlzWzBdKTtcbiAgICByZXR1cm4gdGhpcy5fdmVyc2lvbihzZXJ2ZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgc2VydmVyIHZlcnNpb24gZnJvbSBhbGwgdGhlIHNlcnZlcnNcbiAgICogaW4gdGhlIGJhY2tlbmQgcG9vbCwgZXJyb3JzIGlmIGFueSBvbmUgb2YgdGhlbSBoYXMgYW5cbiAgICogZXJyb3JcbiAgICogXG4gICAqIENhbGxiYWNrcyBmdW5jdGlvbnMgYXJlIGNhbGxlZCBiZWZvcmUvYWZ0ZXIgd2UgcGluZyBtZW1jYWNoZWRcbiAgICogYW5kIHVzZWQgdG8gbG9nIHdoaWNoIGhvc3RzIGFyZSB0aW1pbmcgb3V0LlxuICAgKi9cbiAgYXN5bmMgdmVyc2lvbkFsbChjYWxsYmFja3M/OiB7XG4gICAgYmVmb3JlUGluZz86IChzZXJ2ZXJLZXk6IHN0cmluZykgPT4gdm9pZDtcbiAgICBhZnRlclBpbmc/OiAoc2VydmVyS2V5OiBzdHJpbmcpID0+IHZvaWQ7XG4gIH0pOiBQcm9taXNlPHtcbiAgICB2YWx1ZXM6IFJlY29yZDxzdHJpbmcsIFZhbHVlIHwgbnVsbD47XG4gIH0+IHtcbiAgICBjb25zdCB2ZXJzaW9uT2JqZWN0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgdGhpcy5zZXJ2ZXJLZXlzLm1hcCgoc2VydmVyS2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2VydmVyS2V5VG9TZXJ2ZXIoc2VydmVyS2V5KTtcbiAgICAgICAgY2FsbGJhY2tzPy5iZWZvcmVQaW5nPy4oc2VydmVyS2V5KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3ZlcnNpb24oc2VydmVyKS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgIGNhbGxiYWNrcz8uYWZ0ZXJQaW5nPy4oc2VydmVyS2V5KTtcbiAgICAgICAgICByZXR1cm4geyBzZXJ2ZXJLZXk6IHNlcnZlcktleSwgdmFsdWU6IHJlc3BvbnNlLnZhbHVlIH07XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICApO1xuICAgIGNvbnN0IHZhbHVlcyA9IHZlcnNpb25PYmplY3RzLnJlZHVjZSgoYWNjdW11bGF0b3IsIHZlcnNpb25PYmplY3QpID0+IHtcbiAgICAgIGFjY3VtdWxhdG9yW3ZlcnNpb25PYmplY3Quc2VydmVyS2V5XSA9IHZlcnNpb25PYmplY3QudmFsdWU7XG4gICAgICByZXR1cm4gYWNjdW11bGF0b3I7XG4gICAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgVmFsdWUgfCBudWxsPik7XG4gICAgcmV0dXJuIHsgdmFsdWVzOiB2YWx1ZXMgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgKGFicnVwdGx5KSBjb25uZWN0aW9ucyB0byBhbGwgdGhlIHNlcnZlcnMuXG4gICAqIEBzZWUgdGhpcy5xdWl0XG4gICAqL1xuICBjbG9zZSgpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgdGhpcy5zZXJ2ZXJzW2ldLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gYSBnZW5lcmljIHNpbmdsZSByZXNwb25zZSBvcGVyYXRpb24gKGdldCwgc2V0IGV0Yykgb24gb25lIHNlcnZlclxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IHRoZSBrZXkgdG8gaGFzaCB0byBnZXQgYSBzZXJ2ZXIgZnJvbSB0aGUgcG9vbFxuICAgKiBAcGFyYW0ge2J1ZmZlcn0gcmVxdWVzdCBhIGJ1ZmZlciBjb250YWluaW5nIHRoZSByZXF1ZXN0XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzZXEgdGhlIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgb3BlcmF0aW9uLiBJdCBpcyB1c2VkIHRvIHBpbiB0aGUgY2FsbGJhY2tzXG4gICAgICAgICAgICAgICAgICAgICAgICAgdG8gYSBzcGVjaWZpYyBvcGVyYXRpb24gYW5kIHNob3VsZCBuZXZlciBjaGFuZ2UgZHVyaW5nIGEgYHBlcmZvcm1gLlxuICAgKiBAcGFyYW0ge251bWJlcj99IHJldHJpZXMgbnVtYmVyIG9mIHRpbWVzIHRvIHJldHJ5IHJlcXVlc3Qgb24gZmFpbHVyZVxuICAgKi9cbiAgcGVyZm9ybShcbiAgICBrZXk6IHN0cmluZyxcbiAgICByZXF1ZXN0OiBCdWZmZXIsXG4gICAgc2VxOiBudW1iZXIsXG4gICAgcmV0cmllcz86IG51bWJlclxuICApOiBQcm9taXNlPE1lc3NhZ2U+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgc2VydmVyS2V5ID0gdGhpcy5sb29rdXBLZXlUb1NlcnZlcktleShrZXkpO1xuICAgICAgY29uc3Qgc2VydmVyID0gdGhpcy5zZXJ2ZXJLZXlUb1NlcnZlcihzZXJ2ZXJLZXkpO1xuXG4gICAgICBpZiAoIXNlcnZlcikge1xuICAgICAgICByZXR1cm4gcmVqZWN0KG5ldyBFcnJvcihcIk5vIHNlcnZlcnMgYXZhaWxhYmxlXCIpKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5wZXJmb3JtT25TZXJ2ZXIoXG4gICAgICAgIHNlcnZlcixcbiAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgc2VxLFxuICAgICAgICAoZXJyb3IsIHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVzb2x2ZShyZXNwb25zZSEpO1xuICAgICAgICB9LFxuICAgICAgICByZXRyaWVzXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcGVyZm9ybU9uU2VydmVyKFxuICAgIHNlcnZlcjogU2VydmVyLFxuICAgIHJlcXVlc3Q6IEJ1ZmZlcixcbiAgICBzZXE6IG51bWJlcixcbiAgICBjYWxsYmFjazogUmVzcG9uc2VPckVycm9yQ2FsbGJhY2ssXG4gICAgcmV0cmllczogbnVtYmVyID0gMFxuICApIHtcbiAgICBjb25zdCBfdGhpcyA9IHRoaXM7XG5cbiAgICByZXRyaWVzID0gcmV0cmllcyB8fCB0aGlzLm9wdGlvbnMucmV0cmllcztcbiAgICBjb25zdCBvcmlnUmV0cmllcyA9IHRoaXMub3B0aW9ucy5yZXRyaWVzO1xuICAgIGNvbnN0IGxvZ2dlciA9IHRoaXMub3B0aW9ucy5sb2dnZXI7XG4gICAgY29uc3QgcmV0cnlfZGVsYXkgPSB0aGlzLm9wdGlvbnMucmV0cnlfZGVsYXk7XG5cbiAgICBjb25zdCByZXNwb25zZUhhbmRsZXI6IE9uUmVzcG9uc2VDYWxsYmFjayA9IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgY29uc3QgZXJyb3JIYW5kbGVyOiBPbkVycm9yQ2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgIGlmICgtLXJldHJpZXMgPiAwKSB7XG4gICAgICAgIC8vIFdhaXQgZm9yIHJldHJ5X2RlbGF5XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIF90aGlzLnBlcmZvcm1PblNlcnZlcihzZXJ2ZXIsIHJlcXVlc3QsIHNlcSwgY2FsbGJhY2ssIHJldHJpZXMpO1xuICAgICAgICB9LCAxMDAwICogcmV0cnlfZGVsYXkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmxvZyhcbiAgICAgICAgICBcIk1lbUpTOiBTZXJ2ZXIgPFwiICtcbiAgICAgICAgICAgIHNlcnZlci5ob3N0cG9ydFN0cmluZygpICtcbiAgICAgICAgICAgIFwiPiBmYWlsZWQgYWZ0ZXIgKFwiICtcbiAgICAgICAgICAgIG9yaWdSZXRyaWVzICtcbiAgICAgICAgICAgIFwiKSByZXRyaWVzIHdpdGggZXJyb3IgLSBcIiArXG4gICAgICAgICAgICBlcnJvci5tZXNzYWdlXG4gICAgICAgICk7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICBzZXJ2ZXIub25SZXNwb25zZShzZXEsIHJlc3BvbnNlSGFuZGxlcik7XG4gICAgc2VydmVyLm9uRXJyb3Ioc2VxLCBlcnJvckhhbmRsZXIpO1xuICAgIHNlcnZlci53cml0ZShyZXF1ZXN0KTtcbiAgfVxuXG4gIC8vIEluY3JlbWVudCB0aGUgc2VxIHZhbHVlXG4gIGluY3JTZXEoKSB7XG4gICAgdGhpcy5zZXErKztcblxuICAgIC8vIFdyYXAgYHRoaXMuc2VxYCB0byAzMi1iaXRzIHNpbmNlIHRoZSBmaWVsZCB3ZSBmaXQgaXQgaW50byBpcyBvbmx5IDMyLWJpdHMuXG4gICAgdGhpcy5zZXEgJj0gMHhmZmZmZmZmZjtcblxuICAgIHJldHVybiB0aGlzLnNlcTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQW5kTG9nRXJyb3IoXG4gICAgY29tbWFuZE5hbWU6IHN0cmluZyxcbiAgICByZXNwb25zZVN0YXR1czogUmVzcG9uc2VTdGF0dXMgfCB1bmRlZmluZWRcbiAgKTogRXJyb3Ige1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBNZW1KUyAke2NvbW1hbmROYW1lfTogJHtjb25zdGFudHMucmVzcG9uc2VTdGF0dXNUb1N0cmluZyhcbiAgICAgIHJlc3BvbnNlU3RhdHVzXG4gICAgKX1gO1xuICAgIHRoaXMub3B0aW9ucy5sb2dnZXIubG9nKGVycm9yTWVzc2FnZSk7XG4gICAgcmV0dXJuIG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhbiBlcnJvciB0byB0aGUgbG9nZ2VyLCB0aGVuIHJldHVybiB0aGUgZXJyb3IuXG4gICAqIElmIGEgY2FsbGJhY2sgaXMgZ2l2ZW4sIGNhbGwgaXQgd2l0aCBjYWxsYmFjayhlcnJvciwgbnVsbCkuXG4gICAqL1xuICBwcml2YXRlIGhhbmRsZVJlc3BvbnNlRXJyb3IoXG4gICAgY29tbWFuZE5hbWU6IHN0cmluZyxcbiAgICByZXNwb25zZVN0YXR1czogUmVzcG9uc2VTdGF0dXMgfCB1bmRlZmluZWQsXG4gICAgY2FsbGJhY2s6IHVuZGVmaW5lZCB8ICgoZXJyb3I6IEVycm9yIHwgbnVsbCwgb3RoZXI6IG51bGwpID0+IHZvaWQpXG4gICk6IEVycm9yIHtcbiAgICBjb25zdCBlcnJvciA9IHRoaXMuY3JlYXRlQW5kTG9nRXJyb3IoY29tbWFuZE5hbWUsIHJlc3BvbnNlU3RhdHVzKTtcbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIGNhbGxiYWNrKGVycm9yLCBudWxsKTtcbiAgICB9XG4gICAgcmV0dXJuIGVycm9yO1xuICB9XG59XG5cbmV4cG9ydCB7IENsaWVudCwgU2VydmVyLCBVdGlscywgSGVhZGVyIH07XG4iXX0=