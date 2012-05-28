net = require("net");
header = require("./header");

var Server = function(server, username, password) {
  this.callbackQueue = [];
  hostAr = server.split(":");
  this.host = hostAr[0];
  this.port = parseInt(hostAr[1]) || 11211;
  this.username = username || process.env.MEMCACHIER_USERNAME || process.env.MEMCACHE_USERNAME
  this.password = password || process.env.MEMCACHIER_PASSWORD || process.env.MEMCACHE_PASSWORD
  var self = this;
  this.readAndDo = function(dataBuf) {
    var callback = self.callbackQueue.shift();
    var responseHeader = header.fromBuffer(dataBuf);
    if (responseHeader.status == 1) {
      callback && callback(null);
      return;
    }
    if (responseHeader.status != 0) {
      console.log("Error: " + responseHeader.status);
      callback && callback();
      return
    }
    var extras = dataBuf.slice(24, 24 + responseHeader.extrasLength);
    var key = dataBuf.slice(24 + responseHeader.extrasLength, 24 + responseHeader.keyLength + responseHeader.extrasLength);
    var value = dataBuf.slice(24 + responseHeader.keyLength + responseHeader.extrasLength);
    callback && callback(value, extras);
  }
  return this;
}

Server.prototype = {
  sock: function(go) {
    var self = this;
    if (!this._socket) {
      _socket = net.connect(this.port, this.host, function() {
        _socket.on("data", self.readAndDo);
        go(_socket);
      });
      this._socket = _socket;
    } else {
      go(this._socket);
    }
  },
  close: function() {
    this._socket && this._socket.end();
  },
}

var Client = function(servers) {
  this.servers = servers;
}

Client.prototype = {
  server: function(key) {
    var serv = this.servers.shift();
    this.servers.unshift(serv);
    return serv;
  },
  get: function(key, callback) {
    var buf = new Buffer(24 + key.length);
    var requestHeader = {
      magic: 0x80,
      opcode: 0,
      keyLength: key.length,
      extrasLength: 0,
      totalBodyLength: key.length
    };
    header.toBuffer(requestHeader).copy(buf);
    buf.write(key, 24)
    var serv = this.server(key);
    serv.sock(function(socket) {
      serv.callbackQueue.unshift(callback);
      socket.write(buf);
    });
  },
  set: function(key, value, callback) {
    var buf = new Buffer(24 + key.length + 8 + value.length);
    buf.fill();
    var requestHeader = {
      magic: 0x80,
      opcode: 1,
      keyLength: key.length,
      extrasLength: 8,
      totalBodyLength: key.length + value.length + 8
    };
    header.toBuffer(requestHeader).copy(buf);
    buf.writeUInt32BE(0, 24);
    buf.writeUInt32BE(0, 28);
    buf.write(key, 32);
    buf.write(value, 32 + key.length);
    var serv = this.server(key);
    serv.sock(function(socket) {
      serv.callbackQueue.unshift(callback);
      socket.write(buf);
    });
  }
}

exports.Server = Server;
exports.Client = Client;
