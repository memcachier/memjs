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
        // reset all states except host, port, options, username, password
        this.responseBuffer = Buffer.from([]);
        this.connected = false;
        this.timeoutSet = false;
        this.connectCallbacks = [];
        this.responseCallbacks = {};
        this.requestTimeouts = [];
        this.errorCallbacks = {};
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
        let response;
        try {
            response = utils_1.parseMessage(this.appendToBuffer(dataBuf));
        }
        catch (e) {
            this.error(e);
            return;
        }
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
            self.responseBuffer = Buffer.from([]);
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
                if (Object.keys(self.errorCallbacks).length > 0) {
                    self.error(new Error("socket closed unexpectedly."));
                }
                self.connected = false;
                self.responseBuffer = Buffer.from([]);
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
            // TODO: this should probably be destroy() in at least some, if not all,
            // cases.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL21lbWpzL3NlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSw4Q0FBc0I7QUFDdEIsb0RBQTRCO0FBQzVCLG1DQU1pQjtBQTBCakIsTUFBYSxNQUFPLFNBQVEsZ0JBQU0sQ0FBQyxZQUFZO0lBZ0I3QyxZQUNFLElBQVk7SUFDWixnR0FBZ0c7SUFDaEcsSUFBc0IsRUFDdEIsUUFBaUIsRUFDakIsUUFBaUIsRUFDakIsT0FBZ0M7UUFFaEMsS0FBSyxFQUFFLENBQUM7UUFDUixJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUM7UUFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDeEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEVBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxlQUFlLEdBQUcsRUFBRSxDQUFDO1FBQzFCLElBQUksQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxPQUFPLEdBQUcsYUFBSyxDQUFDLE9BQU8sSUFBSSxFQUFFLEVBQUU7WUFDbEMsT0FBTyxFQUFFLEdBQUc7WUFDWixTQUFTLEVBQUUsS0FBSztZQUNoQixjQUFjLEVBQUUsRUFBRTtTQUNuQixDQUFrQixDQUFDO1FBQ3BCLElBQ0UsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEtBQUssU0FBUztZQUN0QyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsS0FBSyxJQUFJLEVBQ2pDO1lBQ0EsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFX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bnQiOlsiaW1wb3J0IG5ldCBmcm9tIFwibmV0XCI7XG5pbXBvcnQgZXZlbnRzIGZyb20gXCJldmVudHNcIjtcbmltcG9ydCB7XG4gIG1ha2VSZXF1ZXN0QnVmZmVyLFxuICBwYXJzZU1lc3NhZ2UsXG4gIG1lcmdlLFxuICB0aW1lc3RhbXAsXG4gIE1lc3NhZ2UsXG59IGZyb20gXCIuL3V0aWxzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VydmVyT3B0aW9ucyB7XG4gIHRpbWVvdXQ6IG51bWJlcjtcbiAga2VlcEFsaXZlOiBib29sZWFuO1xuICBrZWVwQWxpdmVEZWxheTogbnVtYmVyO1xuICBjb25udGltZW91dDogbnVtYmVyO1xuICB1c2VybmFtZT86IHN0cmluZztcbiAgcGFzc3dvcmQ/OiBzdHJpbmc7XG59XG5cbnR5cGUgU2VxID0gbnVtYmVyO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9uQ29ubmVjdENhbGxiYWNrIHtcbiAgKHNvY2tldDogbmV0LlNvY2tldCk6IHZvaWQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT25SZXNwb25zZUNhbGxiYWNrIHtcbiAgKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkO1xuICBxdWlldD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT25FcnJvckNhbGxiYWNrIHtcbiAgKGVycm9yOiBFcnJvcik6IHZvaWQ7XG59XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXIgZXh0ZW5kcyBldmVudHMuRXZlbnRFbWl0dGVyIHtcbiAgcmVzcG9uc2VCdWZmZXI6IEJ1ZmZlcjtcbiAgaG9zdDogc3RyaW5nO1xuICBwb3J0OiBzdHJpbmcgfCBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIGNvbm5lY3RlZDogYm9vbGVhbjtcbiAgdGltZW91dFNldDogYm9vbGVhbjtcbiAgY29ubmVjdENhbGxiYWNrczogT25Db25uZWN0Q2FsbGJhY2tbXTtcbiAgcmVzcG9uc2VDYWxsYmFja3M6IHsgW3NlcTogc3RyaW5nXTogT25SZXNwb25zZUNhbGxiYWNrIH07XG4gIHJlcXVlc3RUaW1lb3V0czogbnVtYmVyW107XG4gIGVycm9yQ2FsbGJhY2tzOiB7IFtzZXE6IHN0cmluZ106IE9uRXJyb3JDYWxsYmFjayB9O1xuICBvcHRpb25zOiBTZXJ2ZXJPcHRpb25zO1xuICB1c2VybmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwYXNzd29yZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIF9zb2NrZXQ6IG5ldC5Tb2NrZXQgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgaG9zdDogc3RyaW5nLFxuICAgIC8qIFRPRE86IGFsbG93aW5nIHBvcnQgdG8gYmUgc3RyaW5nIG9yIHVuZGVmaW5lZCBpcyB1c2VkIGJ5IHRoZSB0ZXN0cywgYnV0IHNlZW1zIGJhZCBvdmVyYWxsLiAqL1xuICAgIHBvcnQ/OiBzdHJpbmcgfCBudW1iZXIsXG4gICAgdXNlcm5hbWU/OiBzdHJpbmcsXG4gICAgcGFzc3dvcmQ/OiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IFBhcnRpYWw8U2VydmVyT3B0aW9ucz5cbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQnVmZmVyID0gQnVmZmVyLmZyb20oW10pO1xuICAgIHRoaXMuaG9zdCA9IGhvc3Q7XG4gICAgdGhpcy5wb3J0ID0gcG9ydDtcbiAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICAgIHRoaXMudGltZW91dFNldCA9IGZhbHNlO1xuICAgIHRoaXMuY29ubmVjdENhbGxiYWNrcyA9IFtdO1xuICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3MgPSB7fTtcbiAgICB0aGlzLnJlcXVlc3RUaW1lb3V0cyA9IFtdO1xuICAgIHRoaXMuZXJyb3JDYWxsYmFja3MgPSB7fTtcbiAgICB0aGlzLm9wdGlvbnMgPSBtZXJnZShvcHRpb25zIHx8IHt9LCB7XG4gICAgICB0aW1lb3V0OiAwLjUsXG4gICAgICBrZWVwQWxpdmU6IGZhbHNlLFxuICAgICAga2VlcEFsaXZlRGVsYXk6IDMwLFxuICAgIH0pIGFzIFNlcnZlck9wdGlvbnM7XG4gICAgaWYgKFxuICAgICAgdGhpcy5vcHRpb25zLmNvbm50aW1lb3V0ID09PSB1bmRlZmluZWQgfHxcbiAgICAgIHRoaXMub3B0aW9ucy5jb25udGltZW91dCA9PT0gbnVsbFxuICAgICkge1xuICAgICAgdGhpcy5vcHRpb25zLmNvbm50aW1lb3V0ID0gMiAqIHRoaXMub3B0aW9ucy50aW1lb3V0O1xuICAgIH1cbiAgICB0aGlzLnVzZXJuYW1lID1cbiAgICAgIHVzZXJuYW1lIHx8XG4gICAgICB0aGlzLm9wdGlvbnMudXNlcm5hbWUgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hJRVJfVVNFUk5BTUUgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hFX1VTRVJOQU1FO1xuICAgIHRoaXMucGFzc3dvcmQgPVxuICAgICAgcGFzc3dvcmQgfHxcbiAgICAgIHRoaXMub3B0aW9ucy5wYXNzd29yZCB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSElFUl9QQVNTV09SRCB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSEVfUEFTU1dPUkQ7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBvbkNvbm5lY3QoZnVuYzogT25Db25uZWN0Q2FsbGJhY2spIHtcbiAgICB0aGlzLmNvbm5lY3RDYWxsYmFja3MucHVzaChmdW5jKTtcbiAgfVxuXG4gIG9uUmVzcG9uc2Uoc2VxOiBTZXEsIGZ1bmM6IE9uUmVzcG9uc2VDYWxsYmFjaykge1xuICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3Nbc2VxXSA9IGZ1bmM7XG4gIH1cblxuICByZXNwb25kKHJlc3BvbnNlOiBNZXNzYWdlKSB7XG4gICAgY29uc3QgY2FsbGJhY2sgPSB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzW3Jlc3BvbnNlLmhlYWRlci5vcGFxdWVdO1xuICAgIGlmICghY2FsbGJhY2spIHtcbiAgICAgIC8vIGluIGNhc2Ugb2YgYXV0aGVudGljYXRpb24sIG5vIGNhbGxiYWNrIGlzIHJlZ2lzdGVyZWRcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2FsbGJhY2socmVzcG9uc2UpO1xuICAgIGlmICghY2FsbGJhY2sucXVpZXQgfHwgcmVzcG9uc2UuaGVhZGVyLnRvdGFsQm9keUxlbmd0aCA9PT0gMCkge1xuICAgICAgZGVsZXRlIHRoaXMucmVzcG9uc2VDYWxsYmFja3NbcmVzcG9uc2UuaGVhZGVyLm9wYXF1ZV07XG4gICAgICB0aGlzLnJlcXVlc3RUaW1lb3V0cy5zaGlmdCgpO1xuICAgICAgZGVsZXRlIHRoaXMuZXJyb3JDYWxsYmFja3NbcmVzcG9uc2UuaGVhZGVyLm9wYXF1ZV07XG4gICAgfVxuICB9XG5cbiAgb25FcnJvcihzZXE6IFNlcSwgZnVuYzogT25FcnJvckNhbGxiYWNrKSB7XG4gICAgdGhpcy5lcnJvckNhbGxiYWNrc1tzZXFdID0gZnVuYztcbiAgfVxuXG4gIGVycm9yKGVycjogRXJyb3IpIHtcbiAgICBjb25zdCBlcnJjYWxscyA9IHRoaXMuZXJyb3JDYWxsYmFja3M7XG4gICAgLy8gcmVzZXQgYWxsIHN0YXRlcyBleGNlcHQgaG9zdCwgcG9ydCwgb3B0aW9ucywgdXNlcm5hbWUsIHBhc3N3b3JkXG4gICAgdGhpcy5yZXNwb25zZUJ1ZmZlciA9IEJ1ZmZlci5mcm9tKFtdKTtcbiAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICAgIHRoaXMudGltZW91dFNldCA9IGZhbHNlO1xuICAgIHRoaXMuY29ubmVjdENhbGxiYWNrcyA9IFtdO1xuICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3MgPSB7fTtcbiAgICB0aGlzLnJlcXVlc3RUaW1lb3V0cyA9IFtdO1xuICAgIHRoaXMuZXJyb3JDYWxsYmFja3MgPSB7fTtcbiAgICBpZiAodGhpcy5fc29ja2V0KSB7XG4gICAgICB0aGlzLl9zb2NrZXQuZGVzdHJveSgpO1xuICAgICAgZGVsZXRlIHRoaXMuX3NvY2tldDtcbiAgICB9XG4gICAgZm9yIChsZXQgZXJyY2FsbCBvZiBPYmplY3QudmFsdWVzKGVycmNhbGxzKSkge1xuICAgICAgZXJyY2FsbChlcnIpO1xuICAgIH1cbiAgfVxuXG4gIGxpc3RTYXNsKCkge1xuICAgIGNvbnN0IGJ1ZiA9IG1ha2VSZXF1ZXN0QnVmZmVyKDB4MjAsIFwiXCIsIFwiXCIsIFwiXCIpO1xuICAgIHRoaXMud3JpdGVTQVNMKGJ1Zik7XG4gIH1cblxuICBzYXNsQXV0aCgpIHtcbiAgICBjb25zdCBhdXRoU3RyID0gXCJcXHgwMFwiICsgdGhpcy51c2VybmFtZSArIFwiXFx4MDBcIiArIHRoaXMucGFzc3dvcmQ7XG4gICAgY29uc3QgYnVmID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgyMSwgXCJQTEFJTlwiLCBcIlwiLCBhdXRoU3RyKTtcbiAgICB0aGlzLndyaXRlU0FTTChidWYpO1xuICB9XG5cbiAgYXBwZW5kVG9CdWZmZXIoZGF0YUJ1ZjogQnVmZmVyKSB7XG4gICAgY29uc3Qgb2xkID0gdGhpcy5yZXNwb25zZUJ1ZmZlcjtcbiAgICB0aGlzLnJlc3BvbnNlQnVmZmVyID0gQnVmZmVyLmFsbG9jKG9sZC5sZW5ndGggKyBkYXRhQnVmLmxlbmd0aCk7XG4gICAgb2xkLmNvcHkodGhpcy5yZXNwb25zZUJ1ZmZlciwgMCk7XG4gICAgZGF0YUJ1Zi5jb3B5KHRoaXMucmVzcG9uc2VCdWZmZXIsIG9sZC5sZW5ndGgpO1xuICAgIHJldHVybiB0aGlzLnJlc3BvbnNlQnVmZmVyO1xuICB9XG4gIHJlc3BvbnNlSGFuZGxlcihkYXRhQnVmOiBCdWZmZXIpIHtcbiAgICBsZXQgcmVzcG9uc2U6IE1lc3NhZ2UgfCBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgcmVzcG9uc2UgPSBwYXJzZU1lc3NhZ2UodGhpcy5hcHBlbmRUb0J1ZmZlcihkYXRhQnVmKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5lcnJvcihlIGFzIEVycm9yKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgcmVzcExlbmd0aDogbnVtYmVyO1xuICAgIHdoaWxlIChyZXNwb25zZSkge1xuICAgICAgaWYgKHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IDB4MjApIHtcbiAgICAgICAgdGhpcy5zYXNsQXV0aCgpO1xuICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzID09PSAoMHgyMCBhcyBhbnkpIC8qIFRPRE86IHd0Zj8gKi8pIHtcbiAgICAgICAgdGhpcy5lcnJvcihuZXcgRXJyb3IoXCJNZW1jYWNoZWQgc2VydmVyIGF1dGhlbnRpY2F0aW9uIGZhaWxlZCFcIikpO1xuICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5oZWFkZXIub3Bjb2RlID09PSAweDIxKSB7XG4gICAgICAgIHRoaXMuZW1pdChcImF1dGhlbnRpY2F0ZWRcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlc3BvbmQocmVzcG9uc2UpO1xuICAgICAgfVxuICAgICAgcmVzcExlbmd0aCA9IHJlc3BvbnNlLmhlYWRlci50b3RhbEJvZHlMZW5ndGggKyAyNDtcbiAgICAgIHRoaXMucmVzcG9uc2VCdWZmZXIgPSB0aGlzLnJlc3BvbnNlQnVmZmVyLnNsaWNlKHJlc3BMZW5ndGgpO1xuICAgICAgcmVzcG9uc2UgPSBwYXJzZU1lc3NhZ2UodGhpcy5yZXNwb25zZUJ1ZmZlcik7XG4gICAgfVxuICB9XG4gIHNvY2soc2FzbDogYm9vbGVhbiwgZ286IE9uQ29ubmVjdENhbGxiYWNrKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAoIXNlbGYuX3NvY2tldCkge1xuICAgICAgLy8gQ0FTRSAxOiBjb21wbGV0ZWx5IG5ldyBzb2NrZXRcbiAgICAgIHNlbGYuY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICBzZWxmLnJlc3BvbnNlQnVmZmVyID0gQnVmZmVyLmZyb20oW10pO1xuICAgICAgc2VsZi5fc29ja2V0ID0gbmV0LmNvbm5lY3QoXG4gICAgICAgIC8qIFRPRE86IGFsbG93aW5nIHBvcnQgdG8gYmUgc3RyaW5nIG9yIHVuZGVmaW5lZCBpcyB1c2VkIGJ5IHRoZSB0ZXN0cywgYnV0IHNlZW1zIGJhZCBvdmVyYWxsLiAqL1xuICAgICAgICB0eXBlb2YgdGhpcy5wb3J0ID09PSBcInN0cmluZ1wiXG4gICAgICAgICAgPyBwYXJzZUludCh0aGlzLnBvcnQsIDEwKVxuICAgICAgICAgIDogdGhpcy5wb3J0IHx8IDExMjExLFxuICAgICAgICB0aGlzLmhvc3QsXG4gICAgICAgIGZ1bmN0aW9uICh0aGlzOiBuZXQuU29ja2V0KSB7XG4gICAgICAgICAgLy8gU0FTTCBhdXRoZW50aWNhdGlvbiBoYW5kbGVyXG4gICAgICAgICAgc2VsZi5vbmNlKFwiYXV0aGVudGljYXRlZFwiLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc2VsZi5fc29ja2V0KSB7XG4gICAgICAgICAgICAgIGNvbnN0IHNvY2tldCA9IHNlbGYuX3NvY2tldDtcbiAgICAgICAgICAgICAgc2VsZi5jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAvLyBjYW5jZWwgY29ubmVjdGlvbiB0aW1lb3V0XG4gICAgICAgICAgICAgIHNlbGYuX3NvY2tldC5zZXRUaW1lb3V0KDApO1xuICAgICAgICAgICAgICBzZWxmLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgLy8gcnVuIGFjdHVhbCByZXF1ZXN0KHMpXG4gICAgICAgICAgICAgIGdvKHNlbGYuX3NvY2tldCk7XG4gICAgICAgICAgICAgIHNlbGYuY29ubmVjdENhbGxiYWNrcy5mb3JFYWNoKGZ1bmN0aW9uIChjYikge1xuICAgICAgICAgICAgICAgIGNiKHNvY2tldCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICBzZWxmLmNvbm5lY3RDYWxsYmFja3MgPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIHNldHVwIHJlc3BvbnNlIGhhbmRsZXJcbiAgICAgICAgICB0aGlzLm9uKFwiZGF0YVwiLCBmdW5jdGlvbiAoZGF0YUJ1Zikge1xuICAgICAgICAgICAgc2VsZi5yZXNwb25zZUhhbmRsZXIoZGF0YUJ1Zik7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBraWNrIG9mIFNBU0wgaWYgbmVlZGVkXG4gICAgICAgICAgaWYgKHNlbGYudXNlcm5hbWUgJiYgc2VsZi5wYXNzd29yZCkge1xuICAgICAgICAgICAgc2VsZi5saXN0U2FzbCgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZWxmLmVtaXQoXCJhdXRoZW50aWNhdGVkXCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgKTtcblxuICAgICAgLy8gc2V0dXAgZXJyb3IgaGFuZGxlclxuICAgICAgc2VsZi5fc29ja2V0Lm9uKFwiZXJyb3JcIiwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICAgIHNlbGYuZXJyb3IoZXJyb3IpO1xuICAgICAgfSk7XG5cbiAgICAgIHNlbGYuX3NvY2tldC5vbihcImNsb3NlXCIsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKHNlbGYuZXJyb3JDYWxsYmFja3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBzZWxmLmVycm9yKG5ldyBFcnJvcihcInNvY2tldCBjbG9zZWQgdW5leHBlY3RlZGx5LlwiKSk7XG4gICAgICAgIH1cbiAgICAgICAgc2VsZi5jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgc2VsZi5yZXNwb25zZUJ1ZmZlciA9IEJ1ZmZlci5mcm9tKFtdKTtcbiAgICAgICAgaWYgKHNlbGYudGltZW91dFNldCkge1xuICAgICAgICAgIHNlbGYuX3NvY2tldD8uc2V0VGltZW91dCgwKTtcbiAgICAgICAgICBzZWxmLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBzZWxmLl9zb2NrZXQgPSB1bmRlZmluZWQ7XG4gICAgICB9KTtcblxuICAgICAgLy8gc2V0dXAgY29ubmVjdGlvbiB0aW1lb3V0IGhhbmRsZXJcbiAgICAgIHNlbGYudGltZW91dFNldCA9IHRydWU7XG4gICAgICBzZWxmLl9zb2NrZXQuc2V0VGltZW91dChcbiAgICAgICAgc2VsZi5vcHRpb25zLmNvbm50aW1lb3V0ICogMTAwMCxcbiAgICAgICAgZnVuY3Rpb24gKHRoaXM6IG5ldC5Tb2NrZXQpIHtcbiAgICAgICAgICBzZWxmLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICAgICAgICBpZiAoIXNlbGYuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmVuZCgpO1xuICAgICAgICAgICAgc2VsZi5fc29ja2V0ID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgc2VsZi5lcnJvcihuZXcgRXJyb3IoXCJzb2NrZXQgdGltZWQgb3V0IGNvbm5lY3RpbmcgdG8gc2VydmVyLlwiKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICApO1xuXG4gICAgICAvLyB1c2UgVENQIGtlZXAtYWxpdmVcbiAgICAgIHNlbGYuX3NvY2tldC5zZXRLZWVwQWxpdmUoXG4gICAgICAgIHNlbGYub3B0aW9ucy5rZWVwQWxpdmUsXG4gICAgICAgIHNlbGYub3B0aW9ucy5rZWVwQWxpdmVEZWxheSAqIDEwMDBcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmICghc2VsZi5jb25uZWN0ZWQgJiYgIXNhc2wpIHtcbiAgICAgIC8vIENBU0UgMjogc29ja2V0IGV4aXN0cywgYnV0IHN0aWxsIGNvbm5lY3RpbmcgLyBhdXRoZW50aWNhdGluZ1xuICAgICAgc2VsZi5vbkNvbm5lY3QoZ28pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDQVNFIDM6IHNvY2tldCBleGlzdHMgYW5kIGNvbm5lY3RlZCAvIHJlYWR5IHRvIHVzZVxuICAgICAgZ28oc2VsZi5fc29ja2V0KTtcbiAgICB9XG4gIH1cblxuICB3cml0ZShibG9iOiBCdWZmZXIpIHtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICBjb25zdCBkZWFkbGluZSA9IE1hdGgucm91bmQoc2VsZi5vcHRpb25zLnRpbWVvdXQgKiAxMDAwKTtcbiAgICB0aGlzLnNvY2soZmFsc2UsIGZ1bmN0aW9uIChzKSB7XG4gICAgICBzLndyaXRlKGJsb2IpO1xuICAgICAgc2VsZi5yZXF1ZXN0VGltZW91dHMucHVzaCh0aW1lc3RhbXAoKSArIGRlYWRsaW5lKTtcbiAgICAgIGlmICghc2VsZi50aW1lb3V0U2V0KSB7XG4gICAgICAgIHNlbGYudGltZW91dFNldCA9IHRydWU7XG4gICAgICAgIHMuc2V0VGltZW91dChkZWFkbGluZSwgZnVuY3Rpb24gKHRoaXM6IG5ldC5Tb2NrZXQpIHtcbiAgICAgICAgICB0aW1lb3V0SGFuZGxlcihzZWxmLCB0aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICB3cml0ZVNBU0woYmxvYjogQnVmZmVyKSB7XG4gICAgdGhpcy5zb2NrKHRydWUsIGZ1bmN0aW9uIChzKSB7XG4gICAgICBzLndyaXRlKGJsb2IpO1xuICAgIH0pO1xuICB9XG5cbiAgY2xvc2UoKSB7XG4gICAgaWYgKHRoaXMuX3NvY2tldCkge1xuICAgICAgLy8gVE9ETzogdGhpcyBzaG91bGQgcHJvYmFibHkgYmUgZGVzdHJveSgpIGluIGF0IGxlYXN0IHNvbWUsIGlmIG5vdCBhbGwsXG4gICAgICAvLyBjYXNlcy5cbiAgICAgIHRoaXMuX3NvY2tldC5lbmQoKTtcbiAgICB9XG4gIH1cblxuICB0b1N0cmluZygpIHtcbiAgICByZXR1cm4gXCI8U2VydmVyIFwiICsgdGhpcy5ob3N0ICsgXCI6XCIgKyB0aGlzLnBvcnQgKyBcIj5cIjtcbiAgfVxuXG4gIGhvc3Rwb3J0U3RyaW5nKCkge1xuICAgIHJldHVybiB0aGlzLmhvc3QgKyBcIjpcIiArIHRoaXMucG9ydDtcbiAgfVxufVxuXG4vLyBXZSBoYW5kbGUgdHJhY2tpbmcgdGltZW91dHMgd2l0aCBhbiBhcnJheSBvZiBkZWFkbGluZXMgKHJlcXVlc3RUaW1lb3V0cyksIGFzXG4vLyBub2RlIGRvZXNuJ3QgbGlrZSB1cyBzZXR0aW5nIHVwIGxvdHMgb2YgdGltZXJzLCBhbmQgdXNpbmcganVzdCBvbmUgaXMgbW9yZVxuLy8gZWZmaWNpZW50IGFueXdheS5cbmNvbnN0IHRpbWVvdXRIYW5kbGVyID0gZnVuY3Rpb24gKHNlcnZlcjogU2VydmVyLCBzb2NrOiBuZXQuU29ja2V0KSB7XG4gIGlmIChzZXJ2ZXIucmVxdWVzdFRpbWVvdXRzLmxlbmd0aCA9PT0gMCkge1xuICAgIC8vIG5vdGhpbmcgYWN0aXZlXG4gICAgc2VydmVyLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBzb21lIHJlcXVlc3RzIG91dHN0YW5kaW5nLCBjaGVjayBpZiBhbnkgaGF2ZSB0aW1lZC1vdXRcbiAgY29uc3Qgbm93ID0gdGltZXN0YW1wKCk7XG4gIGNvbnN0IHNvb25lc3RUaW1lb3V0ID0gc2VydmVyLnJlcXVlc3RUaW1lb3V0c1swXTtcblxuICBpZiAoc29vbmVzdFRpbWVvdXQgPD0gbm93KSB7XG4gICAgLy8gdGltZW91dCBvY2N1cnJlZCFcbiAgICBzZXJ2ZXIuZXJyb3IobmV3IEVycm9yKFwic29ja2V0IHRpbWVkIG91dCB3YWl0aW5nIG9uIHJlc3BvbnNlLlwiKSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gbm8gdGltZW91dCEgU2V0dXAgbmV4dCBvbmUuXG4gICAgY29uc3QgZGVhZGxpbmUgPSBzb29uZXN0VGltZW91dCAtIG5vdztcbiAgICBzb2NrLnNldFRpbWVvdXQoZGVhZGxpbmUsIGZ1bmN0aW9uICgpIHtcbiAgICAgIHRpbWVvdXRIYW5kbGVyKHNlcnZlciwgc29jayk7XG4gICAgfSk7XG4gIH1cbn07XG4iXX0=