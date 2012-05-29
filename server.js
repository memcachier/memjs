var header = require("./header");
var net = require("net");
var events = require("events");
var util = require("util");

var Server = function(host, port, username, password) {
  events.EventEmitter.call(this)
  this.host = host;
  this.port = port;
  this.username = username || process.env.MEMCACHIER_USERNAME || process.env.MEMCACHE_USERNAME
  this.password = password || process.env.MEMCACHIER_PASSWORD || process.env.MEMCACHE_PASSWORD
  var self = this;
  return this;
}

function parseResponse(dataBuf) {
  var responseHeader = header.fromBuffer(dataBuf);
  var pointer = 24;
  var extras = dataBuf.slice(pointer, (pointer += responseHeader.extrasLength));
  var key = dataBuf.slice(pointer, (pointer += responseHeader.keyLength));
  var value = dataBuf.slice(pointer);
  
  return {header: responseHeader, key: key, extras: extras, value: value};
}

util.inherits(Server, events.EventEmitter);

Server.prototype.sock = function(go) {
  var self = this;
  if (!self._socket) {
    self._socket = net.connect(this.port, this.host, function() {
      self._socket.on("data", function(dataBuf) {
        var response = parseResponse(dataBuf);
        self.emit("response", response);
      });
      go(self._socket);
    });
  } else {
    go(self._socket);
  }
}

Server.prototype.write = function(blob) {
  this.sock(function(s) {
    s.write(blob);
  });
}

Server.prototype.close = function() {
  this._socket && this._socket.end();
}

Server.prototype.toString = function() {
  return "<Server " + this.host + ":" + this.port + ">";
}

exports.Server = Server;