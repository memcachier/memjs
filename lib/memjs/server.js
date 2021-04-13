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
                self.connected = false;
                if (self.timeoutSet) {
                    if (self._socket) {
                        self._socket.setTimeout(0);
                    }
                    self.timeoutSet = false;
                }
                self._socket = undefined;
                self.error(error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL21lbWpzL3NlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSw4Q0FBc0I7QUFDdEIsb0RBQTRCO0FBQzVCLG1DQU1pQjtBQTBCakIsTUFBYSxNQUFPLFNBQVEsZ0JBQU0sQ0FBQyxZQUFZO0lBZ0I3QyxZQUNFLElBQVk7SUFDWixnR0FBZ0c7SUFDaEcsSUFBc0IsRUFDdEIsUUFBaUIsRUFDakIsUUFBaUIsRUFDakIsT0FBZ0M7UUFFaEMsS0FBSyxFQUFFLENBQUM7UUFDUixJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUM7UUFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDeEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEVBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxlQUFlLEdBQUcsRUFBRSxDQUFDO1FBQzFCLElBQUksQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxPQUFPLEdBQUcsYUFBSyxDQUFDLE9BQU8sSUFBSSxFQUFFLEVBQUU7WUFDbEMsT0FBTyxFQUFFLEdBQUc7WUFDWixTQUFTLEVBQUUsS0FBSztZQUNoQixjQUFjLEVBQUUsRUFBRTtTQUNuQixDQUFrQixDQUFDO1FBQ3BCLElBQ0UsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEtBQUssU0FBUztZQUN0QyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsS0FBSyxJQUFJLEVBQ2pDO1lBQ0EsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFX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LE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFakQsSUFBSSxjQUFjLElBQUksR0FBRyxFQUFFO1FBQ3pCLG9CQUFvQjtRQUNwQixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDWCxNQUFNLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQztRQUN6QixNQUFNLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQztRQUMzQixNQUFNLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQztRQUMxQixNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsQ0FBQztLQUNsRTtTQUFNO1FBQ0wsOEJBQThCO1FBQzlCLE1BQU0sUUFBUSxHQUFHLGNBQWMsR0FBRyxHQUFHLENBQUM7UUFDdEMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUU7WUFDeEIsY0FBYyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMvQixDQUFDLENBQUMsQ0FBQztLQUNKO0FBQ0gsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG5ldCBmcm9tIFwibmV0XCI7XG5pbXBvcnQgZXZlbnRzIGZyb20gXCJldmVudHNcIjtcbmltcG9ydCB7XG4gIG1ha2VSZXF1ZXN0QnVmZmVyLFxuICBwYXJzZU1lc3NhZ2UsXG4gIG1lcmdlLFxuICB0aW1lc3RhbXAsXG4gIE1lc3NhZ2UsXG59IGZyb20gXCIuL3V0aWxzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VydmVyT3B0aW9ucyB7XG4gIHRpbWVvdXQ6IG51bWJlcjtcbiAga2VlcEFsaXZlOiBib29sZWFuO1xuICBrZWVwQWxpdmVEZWxheTogbnVtYmVyO1xuICBjb25udGltZW91dDogbnVtYmVyO1xuICB1c2VybmFtZT86IHN0cmluZztcbiAgcGFzc3dvcmQ/OiBzdHJpbmc7XG59XG5cbnR5cGUgU2VxID0gbnVtYmVyO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9uQ29ubmVjdENhbGxiYWNrIHtcbiAgKHNvY2tldDogbmV0LlNvY2tldCk6IHZvaWQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT25SZXNwb25zZUNhbGxiYWNrIHtcbiAgKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkO1xuICBxdWlldD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT25FcnJvckNhbGxiYWNrIHtcbiAgKGVycm9yOiBFcnJvcik6IHZvaWQ7XG59XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXIgZXh0ZW5kcyBldmVudHMuRXZlbnRFbWl0dGVyIHtcbiAgcmVzcG9uc2VCdWZmZXI6IEJ1ZmZlcjtcbiAgaG9zdDogc3RyaW5nO1xuICBwb3J0OiBzdHJpbmcgfCBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIGNvbm5lY3RlZDogYm9vbGVhbjtcbiAgdGltZW91dFNldDogYm9vbGVhbjtcbiAgY29ubmVjdENhbGxiYWNrczogT25Db25uZWN0Q2FsbGJhY2tbXTtcbiAgcmVzcG9uc2VDYWxsYmFja3M6IHsgW3NlcTogc3RyaW5nXTogT25SZXNwb25zZUNhbGxiYWNrIH07XG4gIHJlcXVlc3RUaW1lb3V0czogbnVtYmVyW107XG4gIGVycm9yQ2FsbGJhY2tzOiB7IFtzZXE6IHN0cmluZ106IE9uRXJyb3JDYWxsYmFjayB9O1xuICBvcHRpb25zOiBTZXJ2ZXJPcHRpb25zO1xuICB1c2VybmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwYXNzd29yZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIF9zb2NrZXQ6IG5ldC5Tb2NrZXQgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgaG9zdDogc3RyaW5nLFxuICAgIC8qIFRPRE86IGFsbG93aW5nIHBvcnQgdG8gYmUgc3RyaW5nIG9yIHVuZGVmaW5lZCBpcyB1c2VkIGJ5IHRoZSB0ZXN0cywgYnV0IHNlZW1zIGJhZCBvdmVyYWxsLiAqL1xuICAgIHBvcnQ/OiBzdHJpbmcgfCBudW1iZXIsXG4gICAgdXNlcm5hbWU/OiBzdHJpbmcsXG4gICAgcGFzc3dvcmQ/OiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IFBhcnRpYWw8U2VydmVyT3B0aW9ucz5cbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQnVmZmVyID0gQnVmZmVyLmZyb20oW10pO1xuICAgIHRoaXMuaG9zdCA9IGhvc3Q7XG4gICAgdGhpcy5wb3J0ID0gcG9ydDtcbiAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICAgIHRoaXMudGltZW91dFNldCA9IGZhbHNlO1xuICAgIHRoaXMuY29ubmVjdENhbGxiYWNrcyA9IFtdO1xuICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3MgPSB7fTtcbiAgICB0aGlzLnJlcXVlc3RUaW1lb3V0cyA9IFtdO1xuICAgIHRoaXMuZXJyb3JDYWxsYmFja3MgPSB7fTtcbiAgICB0aGlzLm9wdGlvbnMgPSBtZXJnZShvcHRpb25zIHx8IHt9LCB7XG4gICAgICB0aW1lb3V0OiAwLjUsXG4gICAgICBrZWVwQWxpdmU6IGZhbHNlLFxuICAgICAga2VlcEFsaXZlRGVsYXk6IDMwLFxuICAgIH0pIGFzIFNlcnZlck9wdGlvbnM7XG4gICAgaWYgKFxuICAgICAgdGhpcy5vcHRpb25zLmNvbm50aW1lb3V0ID09PSB1bmRlZmluZWQgfHxcbiAgICAgIHRoaXMub3B0aW9ucy5jb25udGltZW91dCA9PT0gbnVsbFxuICAgICkge1xuICAgICAgdGhpcy5vcHRpb25zLmNvbm50aW1lb3V0ID0gMiAqIHRoaXMub3B0aW9ucy50aW1lb3V0O1xuICAgIH1cbiAgICB0aGlzLnVzZXJuYW1lID1cbiAgICAgIHVzZXJuYW1lIHx8XG4gICAgICB0aGlzLm9wdGlvbnMudXNlcm5hbWUgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hJRVJfVVNFUk5BTUUgfHxcbiAgICAgIHByb2Nlc3MuZW52Lk1FTUNBQ0hFX1VTRVJOQU1FO1xuICAgIHRoaXMucGFzc3dvcmQgPVxuICAgICAgcGFzc3dvcmQgfHxcbiAgICAgIHRoaXMub3B0aW9ucy5wYXNzd29yZCB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSElFUl9QQVNTV09SRCB8fFxuICAgICAgcHJvY2Vzcy5lbnYuTUVNQ0FDSEVfUEFTU1dPUkQ7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBvbkNvbm5lY3QoZnVuYzogT25Db25uZWN0Q2FsbGJhY2spIHtcbiAgICB0aGlzLmNvbm5lY3RDYWxsYmFja3MucHVzaChmdW5jKTtcbiAgfVxuXG4gIG9uUmVzcG9uc2Uoc2VxOiBTZXEsIGZ1bmM6IE9uUmVzcG9uc2VDYWxsYmFjaykge1xuICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3Nbc2VxXSA9IGZ1bmM7XG4gIH1cblxuICByZXNwb25kKHJlc3BvbnNlOiBNZXNzYWdlKSB7XG4gICAgY29uc3QgY2FsbGJhY2sgPSB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzW3Jlc3BvbnNlLmhlYWRlci5vcGFxdWVdO1xuICAgIGlmICghY2FsbGJhY2spIHtcbiAgICAgIC8vIGluIGNhc2Ugb2YgYXV0aGVudGljYXRpb24sIG5vIGNhbGxiYWNrIGlzIHJlZ2lzdGVyZWRcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2FsbGJhY2socmVzcG9uc2UpO1xuICAgIGlmICghY2FsbGJhY2sucXVpZXQgfHwgcmVzcG9uc2UuaGVhZGVyLnRvdGFsQm9keUxlbmd0aCA9PT0gMCkge1xuICAgICAgZGVsZXRlIHRoaXMucmVzcG9uc2VDYWxsYmFja3NbcmVzcG9uc2UuaGVhZGVyLm9wYXF1ZV07XG4gICAgICB0aGlzLnJlcXVlc3RUaW1lb3V0cy5zaGlmdCgpO1xuICAgICAgZGVsZXRlIHRoaXMuZXJyb3JDYWxsYmFja3NbcmVzcG9uc2UuaGVhZGVyLm9wYXF1ZV07XG4gICAgfVxuICB9XG5cbiAgb25FcnJvcihzZXE6IFNlcSwgZnVuYzogT25FcnJvckNhbGxiYWNrKSB7XG4gICAgdGhpcy5lcnJvckNhbGxiYWNrc1tzZXFdID0gZnVuYztcbiAgfVxuXG4gIGVycm9yKGVycjogRXJyb3IpIHtcbiAgICBjb25zdCBlcnJjYWxscyA9IHRoaXMuZXJyb3JDYWxsYmFja3M7XG4gICAgdGhpcy5jb25uZWN0Q2FsbGJhY2tzID0gW107XG4gICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrcyA9IHt9O1xuICAgIHRoaXMucmVxdWVzdFRpbWVvdXRzID0gW107XG4gICAgdGhpcy5lcnJvckNhbGxiYWNrcyA9IHt9O1xuICAgIHRoaXMudGltZW91dFNldCA9IGZhbHNlO1xuICAgIGlmICh0aGlzLl9zb2NrZXQpIHtcbiAgICAgIHRoaXMuX3NvY2tldC5kZXN0cm95KCk7XG4gICAgICBkZWxldGUgdGhpcy5fc29ja2V0O1xuICAgIH1cbiAgICBmb3IgKGxldCBlcnJjYWxsIG9mIE9iamVjdC52YWx1ZXMoZXJyY2FsbHMpKSB7XG4gICAgICBlcnJjYWxsKGVycik7XG4gICAgfVxuICB9XG5cbiAgbGlzdFNhc2woKSB7XG4gICAgY29uc3QgYnVmID0gbWFrZVJlcXVlc3RCdWZmZXIoMHgyMCwgXCJcIiwgXCJcIiwgXCJcIik7XG4gICAgdGhpcy53cml0ZVNBU0woYnVmKTtcbiAgfVxuXG4gIHNhc2xBdXRoKCkge1xuICAgIGNvbnN0IGF1dGhTdHIgPSBcIlxceDAwXCIgKyB0aGlzLnVzZXJuYW1lICsgXCJcXHgwMFwiICsgdGhpcy5wYXNzd29yZDtcbiAgICBjb25zdCBidWYgPSBtYWtlUmVxdWVzdEJ1ZmZlcigweDIxLCBcIlBMQUlOXCIsIFwiXCIsIGF1dGhTdHIpO1xuICAgIHRoaXMud3JpdGVTQVNMKGJ1Zik7XG4gIH1cblxuICBhcHBlbmRUb0J1ZmZlcihkYXRhQnVmOiBCdWZmZXIpIHtcbiAgICBjb25zdCBvbGQgPSB0aGlzLnJlc3BvbnNlQnVmZmVyO1xuICAgIHRoaXMucmVzcG9uc2VCdWZmZXIgPSBCdWZmZXIuYWxsb2Mob2xkLmxlbmd0aCArIGRhdGFCdWYubGVuZ3RoKTtcbiAgICBvbGQuY29weSh0aGlzLnJlc3BvbnNlQnVmZmVyLCAwKTtcbiAgICBkYXRhQnVmLmNvcHkodGhpcy5yZXNwb25zZUJ1ZmZlciwgb2xkLmxlbmd0aCk7XG4gICAgcmV0dXJuIHRoaXMucmVzcG9uc2VCdWZmZXI7XG4gIH1cbiAgcmVzcG9uc2VIYW5kbGVyKGRhdGFCdWY6IEJ1ZmZlcikge1xuICAgIGxldCByZXNwb25zZSA9IHBhcnNlTWVzc2FnZSh0aGlzLmFwcGVuZFRvQnVmZmVyKGRhdGFCdWYpKTtcbiAgICBsZXQgcmVzcExlbmd0aDogbnVtYmVyO1xuICAgIHdoaWxlIChyZXNwb25zZSkge1xuICAgICAgaWYgKHJlc3BvbnNlLmhlYWRlci5vcGNvZGUgPT09IDB4MjApIHtcbiAgICAgICAgdGhpcy5zYXNsQXV0aCgpO1xuICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5oZWFkZXIuc3RhdHVzID09PSAoMHgyMCBhcyBhbnkpIC8qIFRPRE86IHd0Zj8gKi8pIHtcbiAgICAgICAgdGhpcy5lcnJvcihuZXcgRXJyb3IoXCJNZW1jYWNoZWQgc2VydmVyIGF1dGhlbnRpY2F0aW9uIGZhaWxlZCFcIikpO1xuICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5oZWFkZXIub3Bjb2RlID09PSAweDIxKSB7XG4gICAgICAgIHRoaXMuZW1pdChcImF1dGhlbnRpY2F0ZWRcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlc3BvbmQocmVzcG9uc2UpO1xuICAgICAgfVxuICAgICAgcmVzcExlbmd0aCA9IHJlc3BvbnNlLmhlYWRlci50b3RhbEJvZHlMZW5ndGggKyAyNDtcbiAgICAgIHRoaXMucmVzcG9uc2VCdWZmZXIgPSB0aGlzLnJlc3BvbnNlQnVmZmVyLnNsaWNlKHJlc3BMZW5ndGgpO1xuICAgICAgcmVzcG9uc2UgPSBwYXJzZU1lc3NhZ2UodGhpcy5yZXNwb25zZUJ1ZmZlcik7XG4gICAgfVxuICB9XG4gIHNvY2soc2FzbDogYm9vbGVhbiwgZ286IE9uQ29ubmVjdENhbGxiYWNrKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAoIXNlbGYuX3NvY2tldCkge1xuICAgICAgLy8gQ0FTRSAxOiBjb21wbGV0ZWx5IG5ldyBzb2NrZXRcbiAgICAgIHNlbGYuY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICBzZWxmLl9zb2NrZXQgPSBuZXQuY29ubmVjdChcbiAgICAgICAgLyogVE9ETzogYWxsb3dpbmcgcG9ydCB0byBiZSBzdHJpbmcgb3IgdW5kZWZpbmVkIGlzIHVzZWQgYnkgdGhlIHRlc3RzLCBidXQgc2VlbXMgYmFkIG92ZXJhbGwuICovXG4gICAgICAgIHR5cGVvZiB0aGlzLnBvcnQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICA/IHBhcnNlSW50KHRoaXMucG9ydCwgMTApXG4gICAgICAgICAgOiB0aGlzLnBvcnQgfHwgMTEyMTEsXG4gICAgICAgIHRoaXMuaG9zdCxcbiAgICAgICAgZnVuY3Rpb24gKHRoaXM6IG5ldC5Tb2NrZXQpIHtcbiAgICAgICAgICAvLyBTQVNMIGF1dGhlbnRpY2F0aW9uIGhhbmRsZXJcbiAgICAgICAgICBzZWxmLm9uY2UoXCJhdXRoZW50aWNhdGVkXCIsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzZWxmLl9zb2NrZXQpIHtcbiAgICAgICAgICAgICAgY29uc3Qgc29ja2V0ID0gc2VsZi5fc29ja2V0O1xuICAgICAgICAgICAgICBzZWxmLmNvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgICAgIC8vIGNhbmNlbCBjb25uZWN0aW9uIHRpbWVvdXRcbiAgICAgICAgICAgICAgc2VsZi5fc29ja2V0LnNldFRpbWVvdXQoMCk7XG4gICAgICAgICAgICAgIHNlbGYudGltZW91dFNldCA9IGZhbHNlO1xuICAgICAgICAgICAgICAvLyBydW4gYWN0dWFsIHJlcXVlc3QocylcbiAgICAgICAgICAgICAgZ28oc2VsZi5fc29ja2V0KTtcbiAgICAgICAgICAgICAgc2VsZi5jb25uZWN0Q2FsbGJhY2tzLmZvckVhY2goZnVuY3Rpb24gKGNiKSB7XG4gICAgICAgICAgICAgICAgY2Ioc29ja2V0KTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHNlbGYuY29ubmVjdENhbGxiYWNrcyA9IFtdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gc2V0dXAgcmVzcG9uc2UgaGFuZGxlclxuICAgICAgICAgIHRoaXMub24oXCJkYXRhXCIsIGZ1bmN0aW9uIChkYXRhQnVmKSB7XG4gICAgICAgICAgICBzZWxmLnJlc3BvbnNlSGFuZGxlcihkYXRhQnVmKTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIGtpY2sgb2YgU0FTTCBpZiBuZWVkZWRcbiAgICAgICAgICBpZiAoc2VsZi51c2VybmFtZSAmJiBzZWxmLnBhc3N3b3JkKSB7XG4gICAgICAgICAgICBzZWxmLmxpc3RTYXNsKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNlbGYuZW1pdChcImF1dGhlbnRpY2F0ZWRcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICApO1xuXG4gICAgICAvLyBzZXR1cCBlcnJvciBoYW5kbGVyXG4gICAgICBzZWxmLl9zb2NrZXQub24oXCJlcnJvclwiLCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgc2VsZi5jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgaWYgKHNlbGYudGltZW91dFNldCkge1xuICAgICAgICAgIGlmIChzZWxmLl9zb2NrZXQpIHtcbiAgICAgICAgICAgIHNlbGYuX3NvY2tldC5zZXRUaW1lb3V0KDApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZWxmLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBzZWxmLl9zb2NrZXQgPSB1bmRlZmluZWQ7XG4gICAgICAgIHNlbGYuZXJyb3IoZXJyb3IpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIHNldHVwIGNvbm5lY3Rpb24gdGltZW91dCBoYW5kbGVyXG4gICAgICBzZWxmLnRpbWVvdXRTZXQgPSB0cnVlO1xuICAgICAgc2VsZi5fc29ja2V0LnNldFRpbWVvdXQoXG4gICAgICAgIHNlbGYub3B0aW9ucy5jb25udGltZW91dCAqIDEwMDAsXG4gICAgICAgIGZ1bmN0aW9uICh0aGlzOiBuZXQuU29ja2V0KSB7XG4gICAgICAgICAgc2VsZi50aW1lb3V0U2V0ID0gZmFsc2U7XG4gICAgICAgICAgaWYgKCFzZWxmLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgdGhpcy5lbmQoKTtcbiAgICAgICAgICAgIHNlbGYuX3NvY2tldCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHNlbGYuZXJyb3IobmV3IEVycm9yKFwic29ja2V0IHRpbWVkIG91dCBjb25uZWN0aW5nIHRvIHNlcnZlci5cIikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgKTtcblxuICAgICAgLy8gdXNlIFRDUCBrZWVwLWFsaXZlXG4gICAgICBzZWxmLl9zb2NrZXQuc2V0S2VlcEFsaXZlKFxuICAgICAgICBzZWxmLm9wdGlvbnMua2VlcEFsaXZlLFxuICAgICAgICBzZWxmLm9wdGlvbnMua2VlcEFsaXZlRGVsYXkgKiAxMDAwXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAoIXNlbGYuY29ubmVjdGVkICYmICFzYXNsKSB7XG4gICAgICAvLyBDQVNFIDI6IHNvY2tldCBleGlzdHMsIGJ1dCBzdGlsbCBjb25uZWN0aW5nIC8gYXV0aGVudGljYXRpbmdcbiAgICAgIHNlbGYub25Db25uZWN0KGdvKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ0FTRSAzOiBzb2NrZXQgZXhpc3RzIGFuZCBjb25uZWN0ZWQgLyByZWFkeSB0byB1c2VcbiAgICAgIGdvKHNlbGYuX3NvY2tldCk7XG4gICAgfVxuICB9XG5cbiAgd3JpdGUoYmxvYjogQnVmZmVyKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgY29uc3QgZGVhZGxpbmUgPSBNYXRoLnJvdW5kKHNlbGYub3B0aW9ucy50aW1lb3V0ICogMTAwMCk7XG4gICAgdGhpcy5zb2NrKGZhbHNlLCBmdW5jdGlvbiAocykge1xuICAgICAgcy53cml0ZShibG9iKTtcbiAgICAgIHNlbGYucmVxdWVzdFRpbWVvdXRzLnB1c2godGltZXN0YW1wKCkgKyBkZWFkbGluZSk7XG4gICAgICBpZiAoIXNlbGYudGltZW91dFNldCkge1xuICAgICAgICBzZWxmLnRpbWVvdXRTZXQgPSB0cnVlO1xuICAgICAgICBzLnNldFRpbWVvdXQoZGVhZGxpbmUsIGZ1bmN0aW9uICh0aGlzOiBuZXQuU29ja2V0KSB7XG4gICAgICAgICAgdGltZW91dEhhbmRsZXIoc2VsZiwgdGhpcyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgd3JpdGVTQVNMKGJsb2I6IEJ1ZmZlcikge1xuICAgIHRoaXMuc29jayh0cnVlLCBmdW5jdGlvbiAocykge1xuICAgICAgcy53cml0ZShibG9iKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNsb3NlKCkge1xuICAgIGlmICh0aGlzLl9zb2NrZXQpIHtcbiAgICAgIHRoaXMuX3NvY2tldC5lbmQoKTtcbiAgICB9XG4gIH1cblxuICB0b1N0cmluZygpIHtcbiAgICByZXR1cm4gXCI8U2VydmVyIFwiICsgdGhpcy5ob3N0ICsgXCI6XCIgKyB0aGlzLnBvcnQgKyBcIj5cIjtcbiAgfVxuXG4gIGhvc3Rwb3J0U3RyaW5nKCkge1xuICAgIHJldHVybiB0aGlzLmhvc3QgKyBcIjpcIiArIHRoaXMucG9ydDtcbiAgfVxufVxuXG4vLyBXZSBoYW5kbGUgdHJhY2tpbmcgdGltZW91dHMgd2l0aCBhbiBhcnJheSBvZiBkZWFkbGluZXMgKHJlcXVlc3RUaW1lb3V0cyksIGFzXG4vLyBub2RlIGRvZXNuJ3QgbGlrZSB1cyBzZXR0aW5nIHVwIGxvdHMgb2YgdGltZXJzLCBhbmQgdXNpbmcganVzdCBvbmUgaXMgbW9yZVxuLy8gZWZmaWNpZW50IGFueXdheS5cbmNvbnN0IHRpbWVvdXRIYW5kbGVyID0gZnVuY3Rpb24gKHNlcnZlcjogU2VydmVyLCBzb2NrOiBuZXQuU29ja2V0KSB7XG4gIGlmIChzZXJ2ZXIucmVxdWVzdFRpbWVvdXRzLmxlbmd0aCA9PT0gMCkge1xuICAgIC8vIG5vdGhpbmcgYWN0aXZlXG4gICAgc2VydmVyLnRpbWVvdXRTZXQgPSBmYWxzZTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBzb21lIHJlcXVlc3RzIG91dHN0YW5kaW5nLCBjaGVjayBpZiBhbnkgaGF2ZSB0aW1lZC1vdXRcbiAgY29uc3Qgbm93ID0gdGltZXN0YW1wKCk7XG4gIGNvbnN0IHNvb25lc3RUaW1lb3V0ID0gc2VydmVyLnJlcXVlc3RUaW1lb3V0c1swXTtcblxuICBpZiAoc29vbmVzdFRpbWVvdXQgPD0gbm93KSB7XG4gICAgLy8gdGltZW91dCBvY2N1cnJlZCFcbiAgICBzb2NrLmVuZCgpO1xuICAgIHNlcnZlci5jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICBzZXJ2ZXIuX3NvY2tldCA9IHVuZGVmaW5lZDtcbiAgICBzZXJ2ZXIudGltZW91dFNldCA9IGZhbHNlO1xuICAgIHNlcnZlci5lcnJvcihuZXcgRXJyb3IoXCJzb2NrZXQgdGltZWQgb3V0IHdhaXRpbmcgb24gcmVzcG9uc2UuXCIpKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBubyB0aW1lb3V0ISBTZXR1cCBuZXh0IG9uZS5cbiAgICBjb25zdCBkZWFkbGluZSA9IHNvb25lc3RUaW1lb3V0IC0gbm93O1xuICAgIHNvY2suc2V0VGltZW91dChkZWFkbGluZSwgZnVuY3Rpb24gKCkge1xuICAgICAgdGltZW91dEhhbmRsZXIoc2VydmVyLCBzb2NrKTtcbiAgICB9KTtcbiAgfVxufTtcbiJdfQ==