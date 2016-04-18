var net = require('net');
var events = require('events');
var util = require('util');
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var parseMessage = require('./utils').parseMessage;
var merge = require('./utils').merge;

var Server = function(host, port, username, password, options) {
  events.EventEmitter.call(this);
  this.responseBuffer = new Buffer([]);
  this.host = host;
  this.port = port;
  this.connected = false;
  this.connectCallbacks = [];
  this.responseCallbacks = {};
  this.errorCallbacks = {};
  this.options = merge(options || {}, {timeout: 0.5, keepAlive: false, keepAliveDelay: 30});
  this.username = username || this.options.username || process.env.MEMCACHIER_USERNAME || process.env.MEMCACHE_USERNAME;
  this.password = password || this.options.password || process.env.MEMCACHIER_PASSWORD || process.env.MEMCACHE_PASSWORD;
  return this;
};

util.inherits(Server, events.EventEmitter);

Server.prototype.onConnect = function(func) {
  this.connectCallbacks.push(func);
};

Server.prototype.onResponse = function(seq, func) {
  this.responseCallbacks[seq] = func;
};

Server.prototype.respond = function(response) {
  var callback = this.responseCallbacks[response.header.opaque];
  if (!callback) {
    // in case of authentiction, no callback is registered
    return;
  }
  callback(response);
  if (!callback.quiet || response.header.totalBodyLength === 0) {
    delete(this.responseCallbacks[response.header.opaque]);
    delete(this.errorCallbacks[response.header.opaque]);
  }
};

Server.prototype.onError = function(seq, func) {
  this.errorCallbacks[seq] = func;
};

Server.prototype.error = function(err) {
  var errcalls = this.errorCallbacks;
  this.connectCallbacks = [];
  this.responseCallbacks = {};
  this.errorCallbacks = {};
  if (this._socket) {
    this._socket.destroy(); 
    delete(this._socket);
  }
  var k;
  for (k in errcalls) {
    if (errcalls.hasOwnProperty(k)) {
      errcalls[k](err);
    }
  }
};

Server.prototype.listSasl = function() {
  var buf = makeRequestBuffer(0x20, '', '', '');
  this.writeSASL(buf);
};

Server.prototype.saslAuth = function() {
  var authStr = '\0' + this.username + '\0' + this.password;
  var buf = makeRequestBuffer(0x21, 'PLAIN', '', authStr);
  this.writeSASL(buf);
};

Server.prototype.appendToBuffer = function(dataBuf) {
  var old = this.responseBuffer;
  this.responseBuffer = new Buffer(old.length + dataBuf.length);
  old.copy(this.responseBuffer, 0);
  dataBuf.copy(this.responseBuffer, old.length);
  return this.responseBuffer;
};

Server.prototype.responseHandler = function(dataBuf) {
  var response = parseMessage(this.appendToBuffer(dataBuf));
  var respLength;
  while (response) {
    if (response.header.opcode === 0x20) {
      this.saslAuth();
    } else if (response.header.status === 0x20) {
      this.listSasl();
    } else if (response.header.opcode === 0x21) {
      this.emit('authenticated');
    } else {
      this.respond(response);
    }
    respLength = response.header.totalBodyLength + 24;
    this.responseBuffer = this.responseBuffer.slice(respLength);
    response = parseMessage(this.responseBuffer);
  }
};

Server.prototype.sock = function(sasl, go) {
  var self = this;
  var connecting = true;
  var waiting = false;
  if (!self._socket) {
    self.connected = false;
    self._socket = net.connect(this.port, this.host, function() {
      connecting = false;
      self.once('authenticated', function() {
        if (self._socket) {
          self.connected = true;
          waiting = true;
          go(self._socket);
          self.connectCallbacks.forEach(function(cb) {
            cb(self._socket);
          });
          self.connectCallbacks = [];
        }
      });
      this.on('data', function(dataBuf) {
        waiting = false;
        self.responseHandler(dataBuf);
      });
      if (self.username && self.password) {
        self.listSasl();
      } else {
        self.emit('authenticated');
      }
    });
    self._socket.on('error', function(error) {
      connecting = false;
      waiting = false;
      self._socket = undefined;
      self.error(error);
    });
    self._socket.setTimeout(self.options.timeout * 1000, function() {
      if (connecting || waiting) {
        connecting = false;
        waiting = false;
        this.end();
        self._socket = undefined;
        self.error(new Error('socket timed out.'));
      }
    });
    self._socket.setKeepAlive(self.options.keepAlive, self.options.keepAliveDelay * 1000);
  } else if (!self.connected && !sasl) {
    self.onConnect(go);
  } else {
    waiting = true;
    go(self._socket);
  }
};

Server.prototype.write = function(blob) {
  this.sock(false, function(s) {
    s.write(blob);
  });
};

Server.prototype.writeSASL = function(blob) {
  this.sock(true, function(s) {
    s.write(blob);
  });
};

Server.prototype.close = function() {
  if (this._socket) { this._socket.end(); }
};

Server.prototype.toString = function() {
  return '<Server ' + this.host + ':' + this.port + '>';
};

exports.Server = Server;

