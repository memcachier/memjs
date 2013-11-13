var header = require('./header');
var net = require('net');
var events = require('events');
var util = require('util');
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var parseMessage = require('./utils').parseMessage;
var merge = require('./utils').merge;

var Server = function(host, port, username, password, options) {
  events.EventEmitter.call(this)
  this.responseBuffer = new Buffer([]);
  this.host = host;
  this.port = port;
  this.responseCallbacks = {};
  this.errorCallbacks = {};
  this.options = merge(options || {}, {timeout: 0.5});;
  this.username = username || this.options.username || process.env.MEMCACHIER_USERNAME || process.env.MEMCACHE_USERNAME
  this.password = password || this.options.password || process.env.MEMCACHIER_PASSWORD || process.env.MEMCACHE_PASSWORD
  return this;
}

util.inherits(Server, events.EventEmitter);

Server.prototype.onResponse = function(seq, func) {
  this.responseCallbacks[seq] = func;
}

Server.prototype.respond = function(response) {
  var callback = this.responseCallbacks[response.header.opaque];
  if (!callback) {
    // in case of authentiction, no callback is registered
    return;
  }
  callback(response);
  if (!callback.quiet || response.header.totalBodyLength == 0) {
    delete(this.responseCallbacks[response.header.opaque]);
    delete(this.errorCallbacks[response.header.opaque]);
  }
}

Server.prototype.onError = function(seq, func) {
  this.errorCallbacks[seq] = func;
}

Server.prototype.error = function(err) {
  var errcalls = this.errorCallbacks;
  this.responseCallbacks = {};
  this.errorCallbacks = {};
  if (this._socket) {
    this._socket.destroy(); 
    delete(this._socket);
  }
  for (k in errcalls) {
    errcalls[k](err);
  }
}

Server.prototype.listSasl = function() {
  var buf = makeRequestBuffer(0x20, '', '', '');
  this.write(buf);
}

Server.prototype.saslAuth = function() {
  var authStr = '\0' + this.username + '\0' + this.password;
  var buf = makeRequestBuffer(0x21, 'PLAIN', '', authStr);
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
  var response = parseMessage(this.appendToBuffer(dataBuf));
  while (response) {
    if (response.header.opcode == 0x20) {
      this.saslAuth();
    } else if (response.header.status == 0x20) {
      this.listSasl();
    } else if (response.header.opcode == 0x21) {
      this.emit('authenticated');
    } else {
      this.respond(response);
    }
    var respLength = response.header.totalBodyLength + 24
    this.responseBuffer = this.responseBuffer.slice(respLength);
    response = parseMessage(this.responseBuffer);
  }
}

Server.prototype.sock = function(go) {
  var self = this;
  var waiting = false;
  if (!self._socket) {
    self._socket = net.connect(this.port, this.host, function() {
      self.once('authenticated', function() {
        if (self._socket) {
          waiting = true;
          go(self._socket);
        }
      });
      this.on('data', function(dataBuf) {
        waiting = false;
        self.responseHandler(dataBuf)
      });
      if (self.username && self.password) {
        self.listSasl();
      } else {
        self.emit('authenticated');
      }
    });
    self._socket.on('error', function(error) {
      waiting = false;
      self._socket = undefined;
      self.error(error);
    });
    self._socket.setTimeout(self.options.timeout * 1000, function() {
      if (waiting) {
        waiting = false;
        self._socket = undefined;
        this.end();
        self.error(new Error('socket timed out.'));
      }
    });
  } else {
    waiting = true;
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
  return '<Server ' + this.host + ':' + this.port + '>';
}

exports.Server = Server;

