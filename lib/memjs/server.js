"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const net_1 = __importDefault(require("net"));
const events_1 = __importDefault(require("events"));
const utils_1 = require("./utils");
class Server extends events_1.default.EventEmitter {
    constructor(host, 
    /* TODO: allowing port to be string or undefined is used by the tests, but seems bad overall. */
    port, username, password, options) {
        super();
        this.responseBuffer = Buffer.from([]);
        this.host = host;
        this.port = port;
        this.connected = false;
        this.timeoutSet = false;
        this.connectCallbacks = [];
        this.responseCallbacks = {};
        this.requestTimeouts = [];
        this.errorCallbacks = {};
        this.options = utils_1.merge(options || {}, {
            timeout: 0.5,
            keepAlive: false,
            keepAliveDelay: 30,
        });
        if (this.options.conntimeout === undefined ||
            this.options.conntimeout === null) {
            this.options.conntimeout = 2 * this.options.timeout;
        }
        this.username =
            username ||
                this.options.username ||
                process.env.MEMCACHIER_USERNAME ||
                process.env.MEMCACHE_USERNAME;
        this.password =
            password ||
                this.options.password ||
                process.env.MEMCACHIER_PASSWORD ||
                process.env.MEMCACHE_PASSWORD;
        return this;
    }
    onConnect(func) {
        this.connectCallbacks.push(func);
    }
    onResponse(seq, func) {
        this.responseCallbacks[seq] = func;
    }
    respond(response) {
        const callback = this.responseCallbacks[response.header.opaque];
        if (!callback) {
            // in case of authentication, no callback is registered
            return;
        }
        callback(response);
        if (!callback.quiet || response.header.totalBodyLength === 0) {
            delete this.responseCallbacks[response.header.opaque];
            this.requestTimeouts.shift();
            delete this.errorCallbacks[response.header.opaque];
        }
    }
    onError(seq, func) {
        this.errorCallbacks[seq] = func;
    }
    error(err) {
        const errcalls = this.errorCallbacks;
        this.connectCallbacks = [];
        this.responseCallbacks = {};
        this.requestTimeouts = [];
        this.errorCallbacks = {};
        this.timeoutSet = false;
        if (this._socket) {
            this._socket.destroy();
            delete this._socket;
        }
        for (let errcall of Object.values(errcalls)) {
            errcall(err);
        }
    }
    listSasl() {
        const buf = utils_1.makeRequestBuffer(0x20, "", "", "");
        this.writeSASL(buf);
    }
    saslAuth() {
        const authStr = "\x00" + this.username + "\x00" + this.password;
        const buf = utils_1.makeRequestBuffer(0x21, "PLAIN", "", authStr);
        this.writeSASL(buf);
    }
    appendToBuffer(dataBuf) {
        const old = this.responseBuffer;
        this.responseBuffer = Buffer.alloc(old.length + dataBuf.length);
        old.copy(this.responseBuffer, 0);
        dataBuf.copy(this.responseBuffer, old.length);
        return this.responseBuffer;
    }
    responseHandler(dataBuf) {
        let response = utils_1.parseMessage(this.appendToBuffer(dataBuf));
        let respLength;
        while (response) {
            if (response.header.opcode === 0x20) {
                this.saslAuth();
            }
            else if (response.header.status === 0x20 /* TODO: wtf? */) {
                this.error(new Error("Memcached server authentication failed!"));
            }
            else if (response.header.opcode === 0x21) {
                this.emit("authenticated");
            }
            else {
                this.respond(response);
            }
            respLength = response.header.totalBodyLength + 24;
            this.responseBuffer = this.responseBuffer.slice(respLength);
            response = utils_1.parseMessage(this.responseBuffer);
        }
    }
    sock(sasl, go) {
        const self = this;
        if (!self._socket) {
            // CASE 1: completely new socket
            self.connected = false;
            self._socket = net_1.default.connect(
            /* TODO: allowing port to be string or undefined is used by the tests, but seems bad overall. */
            typeof this.port === "string"
                ? parseInt(this.port, 10)
                : this.port || 11211, this.host, function () {
                // SASL authentication handler
                self.once("authenticated", function () {
                    if (self._socket) {
                        const socket = self._socket;
                        self.connected = true;
                        // cancel connection timeout
                        self._socket.setTimeout(0);
                        self.timeoutSet = false;
                        // run actual request(s)
                        go(self._socket);
                        self.connectCallbacks.forEach(function (cb) {
                            cb(socket);
                        });
                        self.connectCallbacks = [];
                    }
                });
                // setup response handler
                this.on("data", function (dataBuf) {
                    self.responseHandler(dataBuf);
                });
                // kick of SASL if needed
                if (self.username && self.password) {
                    self.listSasl();
                }
                else {
                    self.emit("authenticated");
                }
            });
            // setup error handler
            self._socket.on("error", function (error) {
                self.error(error);
            });
            self._socket.on("close", function () {
                var _a;
                self.connected = false;
                if (self.timeoutSet) {
                    (_a = self._socket) === null || _a === void 0 ? void 0 : _a.setTimeout(0);
                    self.timeoutSet = false;
                }
                self._socket = undefined;
            });
            // setup connection timeout handler
            self.timeoutSet = true;
            self._socket.setTimeout(self.options.conntimeout * 1000, function () {
                self.timeoutSet = false;
                if (!self.connected) {
                    this.end();
                    self._socket = undefined;
                    self.error(new Error("socket timed out connecting to server."));
                }
            });
            // use TCP keep-alive
            self._socket.setKeepAlive(self.options.keepAlive, self.options.keepAliveDelay * 1000);
        }
        else if (!self.connected && !sasl) {
            // CASE 2: socket exists, but still connecting / authenticating
            self.onConnect(go);
        }
        else {
            // CASE 3: socket exists and connected / ready to use
            go(self._socket);
        }
    }
    write(blob) {
        const self = this;
        const deadline = Math.round(self.options.timeout * 1000);
        this.sock(false, function (s) {
            s.write(blob);
            self.requestTimeouts.push(utils_1.timestamp() + deadline);
            if (!self.timeoutSet) {
                self.timeoutSet = true;
                s.setTimeout(deadline, function () {
                    timeoutHandler(self, this);
                });
            }
        });
    }
    writeSASL(blob) {
        this.sock(true, function (s) {
            s.write(blob);
        });
    }
    close() {
        if (this._socket) {
            this._socket.end();
        }
    }
    toString() {
        return "<Server " + this.host + ":" + this.port + ">";
    }
    hostportString() {
        return this.host + ":" + this.port;
    }
}
exports.Server = Server;
// We handle tracking timeouts with an array of deadlines (requestTimeouts), as
// node doesn't like us setting up lots of timers, and using just one is more
// efficient anyway.
const timeoutHandler = function (server, sock) {
    if (server.requestTimeouts.length === 0) {
        // nothing active
        server.timeoutSet = false;
        return;
    }
    // some requests outstanding, check if any have timed-out
    const now = utils_1.timestamp();
    const soonestTimeout = server.requestTimeouts[0];
    if (soonestTimeout <= now) {
        // timeout occurred!
        sock.end();
        server.connected = false;
        server._socket = undefined;
        server.timeoutSet = false;
        server.error(new Error("socket timed out waiting on response."));
    }
    else {
        // no timeout! Setup next one.
        const deadline = soonestTimeout - now;
        sock.setTimeout(deadline, function () {
            timeoutHandler(server, sock);
        });
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL21lbWpzL3NlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSw4Q0FBc0I7QUFDdEIsb0RBQTRCO0FBQzVCLG1DQU1pQjtBQTBCakIsTUFBYSxNQUFPLFNBQVEsZ0JBQU0sQ0FBQyxZQUFZO0lBZ0I3QyxZQUNFLElBQVk7SUFDWixnR0FBZ0c7SUFDaEcsSUFBc0IsRUFDdEIsUUFBaUIsRUFDakIsUUFBaUIsRUFDakIsT0FBZ0M7UUFFaEMsS0FBSyxFQUFFLENBQUM7UUFDUixJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUM7UUFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDeEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEVBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxlQUFlLEdBQUcsRUFBRSxDQUFDO1FBQzFCLElBQUksQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxPQUFPLEdBQUcsYUFBSyxDQUFDLE9BQU8sSUFBSSxFQUFFLEVBQUU7WUFDbEMsT0FBTyxFQUFFLEdBQUc7WUFDWixTQUFTLEVBQUUsS0FBSztZQUNoQixjQUFjLEVBQUUsRUFBRTtTQUNuQixDQUFrQixDQUFDO1FBQ3BCLElBQ0UsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEtBQUssU0FBUztZQUN0QyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsS0FBSyxJQUFJLEVBQ2pDO1lBQ0EsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFX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QUFNLEdBQUcsR0FBRyxpQkFBUyxFQUFFLENBQUM7SUFDeEIsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVqRCxJQUFJLGNBQWMsSUFBSSxHQUFHLEVBQUU7UUFDekIsb0JBQW9CO1FBQ3BCLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNYLE1BQU0sQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDO1FBQ3pCLE1BQU0sQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFDO1FBQzNCLE1BQU0sQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDO1FBQzFCLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxDQUFDO0tBQ2xFO1NBQU07UUFDTCw4QkFBOEI7UUFDOUIsTUFBTSxRQUFRLEdBQUcsY0FBYyxHQUFHLEdBQUcsQ0FBQztRQUN0QyxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRTtZQUN4QixjQUFjLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQy9CLENBQUMsQ0FBQyxDQUFDO0tBQ0o7QUFDSCxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbmV0IGZyb20gXCJuZXRcIjtcbmltcG9ydCBldmVudHMgZnJvbSBcImV2ZW50c1wiO1xuaW1wb3J0IHtcbiAgbWFrZVJlcXVlc3RCdWZmZXIsXG4gIHBhcnNlTWVzc2FnZSxcbiAgbWVyZ2UsXG4gIHRpbWVzdGFtcCxcbiAgTWVzc2FnZSxcbn0gZnJvbSBcIi4vdXRpbHNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2ZXJPcHRpb25zIHtcbiAgdGltZW91dDogbnVtYmVyO1xuICBrZWVwQWxpdmU6IGJvb2xlYW47XG4gIGtlZXBBbGl2ZURlbGF5OiBudW1iZXI7XG4gIGNvbm50aW1lb3V0OiBudW1iZXI7XG4gIHVzZXJuYW1lPzogc3RyaW5nO1xuICBwYXNzd29yZD86IHN0cmluZztcbn1cblxudHlwZSBTZXEgPSBudW1iZXI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT25Db25uZWN0Q2FsbGJhY2sge1xuICAoc29ja2V0OiBuZXQuU29ja2V0KTogdm9pZDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBPblJlc3BvbnNlQ2FsbGJhY2sge1xuICAobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQ7XG4gIHF1aWV0PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBPbkVycm9yQ2FsbGJhY2sge1xuICAoZXJyb3I6IEVycm9yKTogdm9pZDtcbn1cblxuZXhwb3J0IGNsYXNzIFNlcnZlciBleHRlbmRzIGV2ZW50cy5FdmVudEVtaXR0ZXIge1xuICByZXNwb25zZUJ1ZmZlcjogQnVmZmVyO1xuICBob3N0OiBzdHJpbmc7XG4gIHBvcnQ6IHN0cmluZyB8IG51bWJlciB8IHVuZGVmaW5lZDtcbiAgY29ubmVjdGVkOiBib29sZWFuO1xuICB0aW1lb3V0U2V0OiBib29sZWFuO1xuICBjb25uZWN0Q2FsbGJhY2tzOiBPbkNvbm5lY3RDYWxsYmFja1tdO1xuICByZXNwb25zZUNhbGxiYWNrczogeyBbc2VxOiBzdHJpbmddOiBPblJlc3BvbnNlQ2FsbGJhY2sgfTtcbiAgcmVxdWVzdFRpbWVvdXRzOiBudW1iZXJbXTtcbiAgZXJyb3JDYWxsYmFja3M6IHsgW3NlcTogc3RyaW5nXTogT25FcnJvckNhbGxiYWNrIH07XG4gIG9wdGlvbnM6IFNlcnZlck9wdGlvbnM7XG4gIHVzZXJuYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHBhc3N3b3JkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgX3NvY2tldDogbmV0LlNvY2tldCB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBob3N0OiBzdHJpbmcsXG4gICAgLyogVE9ETzogYWxsb3dpbmcgcG9ydCB0byBiZSBzdHJpbmcgb3IgdW5kZWZpbmVkIGlzIHVzZWQgYnkgdGhlIHRlc3RzLCBidXQgc2VlbXMgYmFkIG92ZXJhbGwuICovXG4gICAgcG9ydD86IHN0cmluZyB8IG51bWJlcixcbiAgICB1c2VybmFtZT86IHN0cmluZyxcbiAgICBwYXNzd29yZD86IHN0cmluZyxcbiAgICBvcHRpb25zPzogUGFydGlhbDxTZXJ2ZXJPcHRpb25zPlxuICApIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VCdWZmZXIgPSBCdWZmZXIuZnJvbShbXSk7XG4gICAgdGhpcy5ob3N0ID0gaG9zdDtcbiAgICB0aGlzLnBvcnQgPSBwb3J0O1xuICAgIHRoaXMuY29ubmVjdGVkID0gZmFsc2U7XG4gICAgdGhpcy50aW1lb3V0U2V0ID0gZmFsc2U7XG4gICAgdGhpcy5jb25uZWN0Q2FsbGJhY2tzID0gW107XG4gICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrcyA9IHt9O1xuICAgIHRoaXMucmVxdWVzdFRpbWVvdXRzID0gW107XG4gICAgdGhpcy5lcnJvckNhbGxiYWNrcyA9IHt9O1xuICAgIHRoaXMub3B0aW9ucyA9IG1lcmdlKG9wdGlvbnMgfHwge30sIHtcbiAgICAgIHRpbWVvdXQ6IDAuNSxcbiAgICAgIGtlZXBBbGl2ZTogZmFsc2UsXG4gICAgICBrZWVwQWxpdmVEZWxheTogMzAsXG4gICAgfSkgYXMgU2VydmVyT3B0aW9ucztcbiAgICBpZiAoXG4gICAgICB0aGlzLm9wdGlvbnMuY29ubnRpbWVvdXQgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgdGhpcy5vcHRpb25zLmNvbm50aW1lb3V0ID09PSBudWxsXG4gICAgKSB7XG4gICAgICB0aGlzLm9wdGlvbnMuY29ubnRpbWVvdXQgPSAyICogdGhpcy5vcHRpb25zLnRpbWVvdXQ7XG4gICAgfVxuICAgIHRoaXMudXNlcm5hbWUgPVxuICAgICAgdXNlcm5hbWUgfHxcbiAgICAgIHRoaXMub3B0aW9ucy51c2VybmFtZSB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSElFUl9VU0VSTkFNRSB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSEVfVVNFUk5BTUU7XG4gICAgdGhpcy5wYXNzd29yZCA9XG4gICAgICBwYXNzd29yZCB8fFxuICAgICAgdGhpcy5vcHRpb25zLnBhc3N3b3JkIHx8XG4gICAgICBwcm9jZXNzLmVudi5NRU1DQUNISUVSX1BBU1NXT1JEIHx8XG4gICAgICBwcm9jZXNzLmVudi5NRU1DQUNIRV9QQVNTV09SRDtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIG9uQ29ubmVjdChmdW5jOiBPbkNvbm5lY3RDYWxsYmFjaykge1xuICAgIHRoaXMuY29ubmVjdENhbGxiYWNrcy5wdXNoKGZ1bmMpO1xuICB9XG5cbiAgb25SZXNwb25zZShzZXE6IFNlcSwgZnVuYzogT25SZXNwb25zZUNhbGxiYWNrKSB7XG4gICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrc1tzZXFdID0gZnVuYztcbiAgfVxuXG4gIHJlc3BvbmQocmVzcG9uc2U6IE1lc3NhZ2UpIHtcbiAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMucmVzcG9uc2VDYWxsYmFja3NbcmVzcG9uc2UuaGVhZGVyLm9wYXF1ZV07XG4gICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgLy8gaW4gY2FzZSBvZiBhdXRoZW50aWNhdGlvbiwgbm8gY2FsbGJhY2sgaXMgcmVnaXN0ZXJlZFxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjYWxsYmFjayhyZXNwb25zZSk7XG4gICAgaWYgKCFjYWxsYmFjay5xdWlldCB8fCByZXNwb25zZS5oZWFkZXIudG90YWxCb2R5TGVuZ3RoID09PSAwKSB7XG4gICAgICBkZWxldGUgdGhpcy5yZXNwb25zZUNhbGxiYWNrc1tyZXNwb25zZS5oZWFkZXIub3BhcXVlXTtcbiAgICAgIHRoaXMucmVxdWVzdFRpbWVvdXRzLnNoaWZ0KCk7XG4gICAgICBkZWxldGUgdGhpcy5lcnJvckNhbGxiYWNrc1tyZXNwb25zZS5oZWFkZXIub3BhcXVlXTtcbiAgICB9XG4gIH1cblxuICBvbkVycm9yKHNlcTogU2VxLCBmdW5jOiBPbkVycm9yQ2FsbGJhY2spIHtcbiAgICB0aGlzLmVycm9yQ2FsbGJhY2tzW3NlcV0gPSBmdW5jO1xuICB9XG5cbiAgZXJyb3IoZXJyOiBFcnJvcikge1xuICAgIGNvbnN0IGVycmNhbGxzID0gdGhpcy5lcnJvckNhbGxiYWNrcztcbiAgICB0aGlzLmNvbm5lY3RDYWxsYmFja3MgPSBbXTtcbiAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzID0ge307XG4gICAgdGhpcy5yZXF1ZXN0VGltZW91dHMgPSBbXTtcbiAgICB0aGlzLmVycm9yQ2FsbGJhY2tzID0ge307XG4gICAgdGhpcy50aW1lb3V0U2V0ID0gZmFsc2U7XG4gICAgaWYgKHRoaXMuX3NvY2tldCkge1xuICAgICAgdGhpcy5fc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgIGRlbGV0ZSB0aGlzLl9zb2NrZXQ7XG4gICAgfVxuICAgIGZvciAobGV0IGVycmNhbGwgb2YgT2JqZWN0LnZhbHVlcyhlcnJjYWxscykpIHtcbiAgICAgIGVycmNhbGwoZXJyKTtcbiAgICB9XG4gIH1cblxuICBsaXN0U2FzbCgpIHtcbiAgICBjb25zdCBidWYgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDIwLCBcIlwiLCBcIlwiLCBcIlwiKTtcbiAgICB0aGlzLndyaXRlU0FTTChidWYpO1xuICB9XG5cbiAgc2FzbEF1dGgoKSB7XG4gICAgY29uc3QgYXV0aFN0ciA9IFwiXFx4MDBcIiArIHRoaXMudXNlcm5hbWUgKyBcIlxceDAwXCIgKyB0aGlzLnBhc3N3b3JkO1xuICAgIGNvbnN0IGJ1ZiA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MjEsIFwiUExBSU5cIiwgXCJcIiwgYXV0aFN0cik7XG4gICAgdGhpcy53cml0ZVNBU0woYnVmKTtcbiAgfVxuXG4gIGFwcGVuZFRvQnVmZmVyKGRhdGFCdWY6IEJ1ZmZlcikge1xuICAgIGNvbnN0IG9sZCA9IHRoaXMucmVzcG9uc2VCdWZmZXI7XG4gICAgdGhpcy5yZXNwb25zZUJ1ZmZlciA9IEJ1ZmZlci5hbGxvYyhvbGQubGVuZ3RoICsgZGF0YUJ1Zi5sZW5ndGgpO1xuICAgIG9sZC5jb3B5KHRoaXMucmVzcG9uc2VCdWZmZXIsIDApO1xuICAgIGRhdGFCdWYuY29weSh0aGlzLnJlc3BvbnNlQnVmZmVyLCBvbGQubGVuZ3RoKTtcbiAgICByZXR1cm4gdGhpcy5yZXNwb25zZUJ1ZmZlcjtcbiAgfVxuICByZXNwb25zZUhhbmRsZXIoZGF0YUJ1ZjogQnVmZmVyKSB7XG4gICAgbGV0IHJlc3BvbnNlID0gcGFyc2VNZXNzYWdlKHRoaXMuYXBwZW5kVG9CdWZmZXIoZGF0YUJ1ZikpO1xuICAgIGxldCByZXNwTGVuZ3RoOiBudW1iZXI7XG4gICAgd2hpbGUgKHJlc3BvbnNlKSB7XG4gICAgICBpZiAocmVzcG9uc2UuaGVhZGVyLm9wY29kZSA9PT0gMHgyMCkge1xuICAgICAgICB0aGlzLnNhc2xBdXRoKCk7XG4gICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLmhlYWRlci5zdGF0dXMgPT09ICgweDIwIGFzIGFueSkgLyogVE9ETzogd3RmPyAqLykge1xuICAgICAgICB0aGlzLmVycm9yKG5ldyBFcnJvcihcIk1lbWNhY2hlZCBzZXJ2ZXIgYXV0aGVudGljYXRpb24gZmFpbGVkIVwiKSk7XG4gICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IDB4MjEpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiYXV0aGVudGljYXRlZFwiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVzcG9uZChyZXNwb25zZSk7XG4gICAgICB9XG4gICAgICByZXNwTGVuZ3RoID0gcmVzcG9uc2UuaGVhZGVyLnRvdGFsQm9keUxlbmd0aCArIDI0O1xuICAgICAgdGhpcy5yZXNwb25zZUJ1ZmZlciA9IHRoaXMucmVzcG9uc2VCdWZmZXIuc2xpY2UocmVzcExlbmd0aCk7XG4gICAgICByZXNwb25zZSA9IHBhcnNlTWVzc2FnZSh0aGlzLnJlc3BvbnNlQnVmZmVyKTtcbiAgICB9XG4gIH1cbiAgc29jayhzYXNsOiBib29sZWFuLCBnbzogT25Db25uZWN0Q2FsbGJhY2spIHtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcblxuICAgIGlmICghc2VsZi5fc29ja2V0KSB7XG4gICAgICAvLyBDQVNFIDE6IGNvbXBsZXRlbHkgbmV3IHNvY2tldFxuICAgICAgc2VsZi5jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgIHNlbGYuX3NvY2tldCA9IG5ldC5jb25uZWN0KFxuICAgICAgICAvKiBUT0RPOiBhbGxvd2luZyBwb3J0IHRvIGJlIHN0cmluZyBvciB1bmRlZmluZWQgaXMgdXNlZCBieSB0aGUgdGVzdHMsIGJ1dCBzZWVtcyBiYWQgb3ZlcmFsbC4gKi9cbiAgICAgICAgdHlwZW9mIHRoaXMucG9ydCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgID8gcGFyc2VJbnQodGhpcy5wb3J0LCAxMClcbiAgICAgICAgICA6IHRoaXMucG9ydCB8fCAxMTIxMSxcbiAgICAgICAgdGhpcy5ob3N0LFxuICAgICAgICBmdW5jdGlvbiAodGhpczogbmV0LlNvY2tldCkge1xuICAgICAgICAgIC8vIFNBU0wgYXV0aGVudGljYXRpb24gaGFuZGxlclxuICAgICAgICAgIHNlbGYub25jZShcImF1dGhlbnRpY2F0ZWRcIiwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHNlbGYuX3NvY2tldCkge1xuICAgICAgICAgICAgICBjb25zdCBzb2NrZXQgPSBzZWxmLl9zb2NrZXQ7XG4gICAgICAgICAgICAgIHNlbGYuY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgLy8gY2FuY2VsIGNvbm5lY3Rpb24gdGltZW91dFxuICAgICAgICAgICAgICBzZWxmLl9zb2NrZXQuc2V0VGltZW91dCgwKTtcbiAgICAgICAgICAgICAgc2VsZi50aW1lb3V0U2V0ID0gZmFsc2U7XG4gICAgICAgICAgICAgIC8vIHJ1biBhY3R1YWwgcmVxdWVzdChzKVxuICAgICAgICAgICAgICBnbyhzZWxmLl9zb2NrZXQpO1xuICAgICAgICAgICAgICBzZWxmLmNvbm5lY3RDYWxsYmFja3MuZm9yRWFjaChmdW5jdGlvbiAoY2IpIHtcbiAgICAgICAgICAgICAgICBjYihzb2NrZXQpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgc2VsZi5jb25uZWN0Q2FsbGJhY2tzID0gW107XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBzZXR1cCByZXNwb25zZSBoYW5kbGVyXG4gICAgICAgICAgdGhpcy5vbihcImRhdGFcIiwgZnVuY3Rpb24gKGRhdGFCdWYpIHtcbiAgICAgICAgICAgIHNlbGYucmVzcG9uc2VIYW5kbGVyKGRhdGFCdWYpO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8ga2ljayBvZiBTQVNMIGlmIG5lZWRlZFxuICAgICAgICAgIGlmIChzZWxmLnVzZXJuYW1lICYmIHNlbGYucGFzc3dvcmQpIHtcbiAgICAgICAgICAgIHNlbGYubGlzdFNhc2woKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc2VsZi5lbWl0KFwiYXV0aGVudGljYXRlZFwiKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIC8vIHNldHVwIGVycm9yIGhhbmRsZXJcbiAgICAgIHNlbGYuX3NvY2tldC5vbihcImVycm9yXCIsIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgICBzZWxmLmVycm9yKGVycm9yKTtcbiAgICAgIH0pO1xuXG4gICAgICBzZWxmLl9zb2NrZXQub24oXCJjbG9zZVwiLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYuY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIGlmIChzZWxmLnRpbWVvdXRTZXQpIHtcbiAgICAgICAgICBzZWxmLl9zb2NrZXQ/LnNldFRpbWVvdXQoMCk7XG4gICAgICAgICAgc2VsZi50aW1lb3V0U2V0ID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgc2VsZi5fc29ja2V0ID0gdW5kZWZpbmVkO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIHNldHVwIGNvbm5lY3Rpb24gdGltZW91dCBoYW5kbGVyXG4gICAgICBzZWxmLnRpbWVvdXRTZXQgPSB0cnVlO1xuICAgICAgc2VsZi5fc29ja2V0LnNldFRpbWVvdXQoXG4gICAgICAgIHNlbGYub3B0aW9ucy5jb25udGltZW91dCAqIDEwMDAsXG4gICAgICAgIGZ1bmN0aW9uICh0aGlzOiBuZXQuU29ja2V0KSB7XG4gICAgICAgICAgc2VsZi50aW1lb3V0U2V0ID0gZmFsc2U7XG4gICAgICAgICAgaWYgKCFzZWxmLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgdGhpcy5lbmQoKTtcbiAgICAgICAgICAgIHNlbGYuX3NvY2tldCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHNlbGYuZXJyb3IobmV3IEVycm9yKFwic29ja2V0IHRpbWVkIG91dCBjb25uZWN0aW5nIHRvIHNlcnZlci5cIikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgKTtcblxuICAgICAgLy8gdXNlIFRDUCBrZWVwLWFsaXZlXG4gICAgICBzZWxmLl9zb2NrZXQuc2V0S2VlcEFsaXZlKFxuICAgICAgICBzZWxmLm9wdGlvbnMua2VlcEFsaXZlLFxuICAgICAgICBzZWxmLm9wdGlvbnMua2VlcEFsaXZlRGVsYXkgKiAxMDAwXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAoIXNlbGYuY29ubmVjdGVkICYmICFzYXNsKSB7XG4gICAgICAvLyBDQVNFIDI6IHNvY2tldCBleGlzdHMsIGJ1dCBzdGlsbCBjb25uZWN0aW5nIC8gYXV0aGVudGljYXRpbmdcbiAgICAgIHNlbGYub25Db25uZWN0KGdvKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ0FTRSAzOiBzb2NrZXQgZXhpc3RzIGFuZCBjb25uZWN0ZWQgLyByZWFkeSB0byB1c2VcbiAgICAgIGdvKHNlbGYuX3NvY2tldCk7XG4gICAgfVxuICB9XG5cbiAgd3JpdGUoYmxvYjogQnVmZmVyKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgY29uc3QgZGVhZGxpbmUgPSBNYXRoLnJvdW5kKHNlbGYub3B0aW9ucy50aW1lb3V0ICogMTAwMCk7XG4gICAgdGhpcy5zb2NrKGZhbHNlLCBmdW5jdGlvbiAocykge1xuICAgICAgcy53cml0ZShibG9iKTtcbiAgICAgIHNlbGYucmVxdWVzdFRpbWVvdXRzLnB1c2godGltZXN0YW1wKCkgKyBkZWFkbGluZSk7XG4gICAgICBpZiAoIXNlbGYudGltZW91dFNldCkge1xuICAgICAgICBzZWxmLnRpbWVvdXRTZXQgPSB0cnVlO1xuICAgICAgICBzLnNldFRpbWVvdXQoZGVhZGxpbmUsIGZ1bmN0aW9uICh0aGlzOiBuZXQuU29ja2V0KSB7XG4gICAgICAgICAgdGltZW91dEhhbmRsZXIoc2VsZiwgdGhpcyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgd3JpdGVTQVNMKGJsb2I6IEJ1ZmZlcikge1xuICAgIHRoaXMuc29jayh0cnVlLCBmdW5jdGlvbiAocykge1xuICAgICAgcy53cml0ZShibG9iKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNsb3NlKCkge1xuICAgIGlmICh0aGlzLl9zb2NrZXQpIHtcbiAgICAgIHRoaXMuX3NvY2tldC5lbmQoKTtcbiAgICB9XG4gIH1cblxuICB0b1N0cmluZygpIHtcbiAgICByZXR1cm4gXCI8U2VydmVyIFwiICsgdGhpcy5ob3N0ICsgXCI6XCIgKyB0aGlzLnBvcnQgKyBcIj5cIjtcbiAgfVxuXG4gIGhvc3Rwb3J0U3RyaW5nKCkge1xuICAgIHJldHVybiB0aGlzLmhvc3QgKyBcIjpcIiArIHRoaXMucG9ydDtcbiAgfVxufVxuXG4vLyBXZSBoYW5kbGUgdHJhY2tpbmcgdGltZW91dHMgd2l0aCBhbiBhcnJheSBvZiBkZWFkbGluZXMgKHJlcXVlc3RUaW1lb3V0cyksIGFzXG4vLyBub2RlIGRvZXNuJ3QgbGlrZSB1cyBzZXR0aW5nIHVwIGxvdHMgb2YgdGltZXJzLCBhbmQgdXNpbmcganVzdCBvbmUgaXMgbW9yZVxuLy8gZWZmaWNpZW50IGFueXdheS5cbmNvbnN0IHRpbWVvdXRIYW5kbGVyID0gZnVuY3Rpb24gKHNlcnZlcjogU2VydmVyLCBzb2NrOiBuZXQuU29ja2V0KSB7XG4gIGlmIChzZXJ2ZXIucmVxdWVzdFRpbWVvdXRzLmxlbmd0aCA9PT0gMCkge1xuICAgIC8vIG5vdGhpbmcgYWN0aXZlXG4gICAgc2VydmVyLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBzb21lIHJlcXVlc3RzIG91dHN0YW5kaW5nLCBjaGVjayBpZiBhbnkgaGF2ZSB0aW1lZC1vdXRcbiAgY29uc3Qgbm93ID0gdGltZXN0YW1wKCk7XG4gIGNvbnN0IHNvb25lc3RUaW1lb3V0ID0gc2VydmVyLnJlcXVlc3RUaW1lb3V0c1swXTtcblxuICBpZiAoc29vbmVzdFRpbWVvdXQgPD0gbm93KSB7XG4gICAgLy8gdGltZW91dCBvY2N1cnJlZCFcbiAgICBzb2NrLmVuZCgpO1xuICAgIHNlcnZlci5jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICBzZXJ2ZXIuX3NvY2tldCA9IHVuZGVmaW5lZDtcbiAgICBzZXJ2ZXIudGltZW91dFNldCA9IGZhbHNlO1xuICAgIHNlcnZlci5lcnJvcihuZXcgRXJyb3IoXCJzb2NrZXQgdGltZWQgb3V0IHdhaXRpbmcgb24gcmVzcG9uc2UuXCIpKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBubyB0aW1lb3V0ISBTZXR1cCBuZXh0IG9uZS5cbiAgICBjb25zdCBkZWFkbGluZSA9IHNvb25lc3RUaW1lb3V0IC0gbm93O1xuICAgIHNvY2suc2V0VGltZW91dChkZWFkbGluZSwgZnVuY3Rpb24gKCkge1xuICAgICAgdGltZW91dEhhbmRsZXIoc2VydmVyLCBzb2NrKTtcbiAgICB9KTtcbiAgfVxufTtcbiJdfQ==