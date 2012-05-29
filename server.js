var header = require('./header');
var net = require('net');
var events = require('events');
var util = require('util');
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var parseResponse = require('./utils').parseResponse;

var Server = function(host, port, options) {
  events.EventEmitter.call(this)
  this.responseBuffer = new Buffer([]);
  this.host = host;
  this.port = port;
  options = options || {};
  this.username = options.username || process.env.MEMCACHIER_USERNAME || process.env.MEMCACHE_USERNAME
  this.password = options.password || process.env.MEMCACHIER_PASSWORD || process.env.MEMCACHE_PASSWORD
  return this;
}

util.inherits(Server, events.EventEmitter);

Server.prototype.listSasl = function() {
  var buf = makeRequestBuffer(0x20, '', '', '');
  this.write(buf);
}

Server.prototype.saslAuth = function() {
  var authStr = '\0' + this.username + '\0' + this.password;
  var buf = makeRequestBuffer(0x21, '', '', authStr);
  this.write(buf);
}

Server.prototype.appendToBuffer = function(dataBuf) {
  var old = this.responseBuffer;
  this.responseBuffer = new Buffer(old.length + dataBuf.length);
  old.copy(this.responseBuffer, 0);
  dataBuf.copy(this.responseBuffer, old.length);
  return this.responseBuffer;
}

Server.prototype.responseHandler = function(dataBuf) {
  var response = parseResponse(this.appendToBuffer(dataBuf));
  while (response) {
    if (response.header.opcode == 0x20) {
      this.saslAuth();
    } else if (response.header.status == 0x20) {
      this.listSasl();
    } else if (response.header.opcode == 0x21) {
      this.emit('authenticated');
    } else {
      this.emit('response', response);
    }
    var respLength = response.header.totalBodyLength + 24
    this.responseBuffer = this.responseBuffer.slice(respLength);
    response = parseResponse(this.responseBuffer);
  }
}

Server.prototype.sock = function(go) {
  var self = this;
  if (!self._socket) {
    self._socket = net.connect(this.port, this.host, function() {
      self.once('authenticated', function() {
        go(self._socket);
      });
      this.on('data', function(dataBuf) {
        self.responseHandler(dataBuf)
      });
      if (self.username && self.password) {
        self.listSasl();
      } else {
        self.emit('authenticated');
      }
    });
  } else {
    go(self._socket, false);
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
  return '<Server ' + this.host + ':' + this.port + '>';
}

exports.Server = Server;