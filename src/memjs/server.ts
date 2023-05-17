import net from "net";
import events from "events";
import {
  makeRequestBuffer,
  parseMessage,
  merge,
  timestamp,
  Message,
} from "./utils";

export interface ServerOptions {
  timeout: number;
  keepAlive: boolean;
  keepAliveDelay: number;
  conntimeout: number;
  username?: string;
  password?: string;
}

type Seq = number;

export interface OnConnectCallback {
  (socket: net.Socket): void;
}

export interface OnResponseCallback {
  (message: Message): void;
  quiet?: boolean;
}

export interface OnErrorCallback {
  (error: Error): void;
}

export class Server extends events.EventEmitter {
  responseBuffer: Buffer;
  host: string;
  port: string | number | undefined;
  connected: boolean;
  timeoutSet: boolean;
  connectCallbacks: OnConnectCallback[];
  responseCallbacks: { [seq: string]: OnResponseCallback };
  requestTimeouts: number[];
  errorCallbacks: { [seq: string]: OnErrorCallback };
  options: ServerOptions;
  username: string | undefined;
  password: string | undefined;

  _socket: net.Socket | undefined;

  constructor(
    host: string,
    /* TODO: allowing port to be string or undefined is used by the tests, but seems bad overall. */
    port?: string | number,
    username?: string,
    password?: string,
    options?: Partial<ServerOptions>
  ) {
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
    this.options = merge(options || {}, {
      timeout: 0.5,
      keepAlive: false,
      keepAliveDelay: 30,
    }) as ServerOptions;
    if (
      this.options.conntimeout === undefined ||
      this.options.conntimeout === null
    ) {
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

  onConnect(func: OnConnectCallback) {
    this.connectCallbacks.push(func);
  }

  onResponse(seq: Seq, func: OnResponseCallback) {
    this.responseCallbacks[seq] = func;
  }

  respond(response: Message) {
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

  onError(seq: Seq, func: OnErrorCallback) {
    this.errorCallbacks[seq] = func;
  }

  error(err: Error) {
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
    const buf = makeRequestBuffer(0x20, "", "", "");
    this.writeSASL(buf);
  }

  saslAuth() {
    const authStr = "\x00" + this.username + "\x00" + this.password;
    const buf = makeRequestBuffer(0x21, "PLAIN", "", authStr);
    this.writeSASL(buf);
  }

  appendToBuffer(dataBuf: Buffer) {
    const old = this.responseBuffer;
    this.responseBuffer = Buffer.alloc(old.length + dataBuf.length);
    old.copy(this.responseBuffer, 0);
    dataBuf.copy(this.responseBuffer, old.length);
    return this.responseBuffer;
  }
  responseHandler(dataBuf: Buffer) {
    let response = parseMessage(this.appendToBuffer(dataBuf));
    let respLength: number;
    while (response) {
      if (response.header.opcode === 0x20) {
        this.saslAuth();
      } else if (response.header.status === (0x20 as any) /* TODO: wtf? */) {
        this.error(new Error("Memcached server authentication failed!"));
      } else if (response.header.opcode === 0x21) {
        this.emit("authenticated");
      } else {
        this.respond(response);
      }
      respLength = response.header.totalBodyLength + 24;
      this.responseBuffer = this.responseBuffer.slice(respLength);
      response = parseMessage(this.responseBuffer);
    }
  }
  sock(sasl: boolean, go: OnConnectCallback) {
    const self = this;

    if (!self._socket) {
      // CASE 1: completely new socket
      self.connected = false;
      self._socket = net.connect(
        /* TODO: allowing port to be string or undefined is used by the tests, but seems bad overall. */
        typeof this.port === "string"
          ? parseInt(this.port, 10)
          : this.port || 11211,
        this.host,
        function (this: net.Socket) {
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
          } else {
            self.emit("authenticated");
          }
        }
      );

      // setup error handler
      self._socket.on("error", function (error) {
        self.error(error);
      });

      self._socket.on("close", function () {
        self.connected = false;
        if (self.timeoutSet) {
          self._socket?.setTimeout(0);
          self.timeoutSet = false;
        }
        self._socket = undefined;
      });

      // setup connection timeout handler
      self.timeoutSet = true;
      self._socket.setTimeout(
        self.options.conntimeout * 1000,
        function (this: net.Socket) {
          self.timeoutSet = false;
          if (!self.connected) {
            this.end();
            self._socket = undefined;
            self.error(new Error("socket timed out connecting to server."));
          }
        }
      );

      // use TCP keep-alive
      self._socket.setKeepAlive(
        self.options.keepAlive,
        self.options.keepAliveDelay * 1000
      );
    } else if (!self.connected && !sasl) {
      // CASE 2: socket exists, but still connecting / authenticating
      self.onConnect(go);
    } else {
      // CASE 3: socket exists and connected / ready to use
      go(self._socket);
    }
  }

  write(blob: Buffer) {
    const self = this;
    const deadline = Math.round(self.options.timeout * 1000);
    this.sock(false, function (s) {
      s.write(blob);
      self.requestTimeouts.push(timestamp() + deadline);
      if (!self.timeoutSet) {
        self.timeoutSet = true;
        s.setTimeout(deadline, function (this: net.Socket) {
          timeoutHandler(self, this);
        });
      }
    });
  }

  writeSASL(blob: Buffer) {
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

// We handle tracking timeouts with an array of deadlines (requestTimeouts), as
// node doesn't like us setting up lots of timers, and using just one is more
// efficient anyway.
const timeoutHandler = function (server: Server, sock: net.Socket) {
  if (server.requestTimeouts.length === 0) {
    // nothing active
    server.timeoutSet = false;
    return;
  }

  // some requests outstanding, check if any have timed-out
  const now = timestamp();
  const soonestTimeout = server.requestTimeouts[0];

  if (soonestTimeout <= now) {
    // timeout occurred!
    sock.end();
    server.connected = false;
    server._socket = undefined;
    server.timeoutSet = false;
    server.error(new Error("socket timed out waiting on response."));
  } else {
    // no timeout! Setup next one.
    const deadline = soonestTimeout - now;
    sock.setTimeout(deadline, function () {
      timeoutHandler(server, sock);
    });
  }
};
