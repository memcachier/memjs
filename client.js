var errors = require('./protocol').errors;
var Server = require('./server').Server;
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var hashCode = require('./utils').hashCode;

var Client = function(servers) {
  this.servers = servers;
}

Client.prototype.server = function(key) {
  return this.servers[hashCode(key) % this.servers.length];
}

Client.prototype.get = function(key, callback) {
  var buf = makeRequestBuffer(0, key, '', '');
  var serv = this.server(key);
  serv.once('response', function(response) {
    switch (response.header.status) {
    case  0:
      callback(response.value, response.extras)
      break;
    case 1:
      callback(null, null);
      break;
    default:
      console.log('MemJS GET: ' + errors[response.header.status]);
      callback();
    }
  });
  serv.write(buf);
}

Client.prototype.set = function(key, value, callback) {
  var buf = makeRequestBuffer(1, key, '\0\0\0\0\0\0\0\0', value);
  var serv = this.server(key);
  serv.once('response', function(response) {
    switch (response.header.status) {
    case  0:
      callback(true)
      break;
    default:
      console.log('MemJS SET: ' + errors[response.header.status]);
      callback();
    }
  });
  serv.write(buf);
}

Client.prototype.stats = function(callback) {
  var buf = makeRequestBuffer(0x10, '', '', '');
  var result = {};
  for (i in this.servers) {
    var serv = this.servers[i];
    serv.on('response', function statsHandler(response) {
      if (response.header.totalBodyLength == 0) {
        serv.removeListener('response', statsHandler);
        callback(result);
        return;
      }
      switch (response.header.status) {
      case  0:
        result[response.key.toString()] = response.value.toString();
        break;
      default:
        console.log('MemJS STATS: ' + response.header.status);
        callback();
      }
    });
    serv.write(buf);
  }
}

Client.prototype.close = function() {
  for (i in this.servers) {
    this.servers[i].close();
  }
}

exports.Client = Client;
exports.Server = Server;
