var errors = require('./protocol').errors;
var Server = require('./server').Server;
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var hashCode = require('./utils').hashCode;

// Client initializer takes a list of Servers.
var Client = function(servers) {
  this.servers = servers;
}

// Client
// ------
//
// Creates a new client given an optional config string and optional hash of
// options. The config string should be of the form:
//
//   "server1:11211,server2:11211,server3:11211"
//
// If the argument is not given, fallback on the MEMCACHIER_SERVERS environment
// variable, MEMCACHE_SERVERS environment variable or "localhost:11211".
//
// The options hash may contain a username and password to pass to the servers
// to use for SASL authentication.
Client.create = function(serversStr, options) {
  serversStr = serversStr || process.env.MEMCACHIER_SERVERS || process.env.MEMCACHE_SERVERS || "localhost:11211";
  var serverUris = serversStr.split(",");
  var servers = serverUris.map(function(uri) {
    var uriParts = uri.split(":");
    return new Server(uriParts[0], parseInt(uriParts[1] || 11211));
  });
  return new Client(servers);
}

// Chooses the server to talk to by hashing the given key.
// TODO(alevy): should use consistent hashing and/or allow swaping hashing
// mechanisms
Client.prototype.server = function(key) {
  return this.servers[hashCode(key) % this.servers.length];
}

// GET
//
// Takes a key to get from memcache and a callback. If the key is found, the
// callback is invoked with the arguments _value_, _extras_. If the key is not
// found, the callback is invoked with null for both arguments. If there is a
// different error, the error is logged to the console and the callback is
// invoked with no arguments.
Client.prototype.get = function(key, callback) {
  var buf = makeRequestBuffer(0, key, '', '');
  var serv = this.server(key);
  serv.once('response', function(response) {
    switch (response.header.status) {
    case  0:
      callback && callback(response.value, response.extras)
      break;
    case 1:
      callback && callback(null, null);
      break;
    default:
      console.log('MemJS GET: ' + errors[response.header.status]);
      callback && callback();
    }
  });
  serv.write(buf);
}

// SET
//
// Takes a key and value to put to memcache and a callback. The success of the
// operation is signaled through the argument to the callback.
Client.prototype.set = function(key, value, callback) {
  var buf = makeRequestBuffer(1, key, '\0\0\0\0\0\0\0\0', value);
  var serv = this.server(key);
  serv.once('response', function(response) {
    switch (response.header.status) {
    case  0:
      callback && callback(true)
      break;
    default:
      console.log('MemJS SET: ' + errors[response.header.status]);
      callback && callback();
    }
  });
  serv.write(buf);
}

// STATS
//
// Invokes the callback with a dictionary of statistics from each server.
Client.prototype.stats = function(callback) {
  var buf = makeRequestBuffer(0x10, '', '', '');
  var result = {};
  for (i in this.servers) {
    var serv = this.servers[i];
    serv.on('response', function statsHandler(response) {
      if (response.header.totalBodyLength == 0) {
        serv.removeListener('response', statsHandler);
        callback && callback(result);
        return;
      }
      switch (response.header.status) {
      case  0:
        result[response.key.toString()] = response.value.toString();
        break;
      default:
        console.log('MemJS STATS: ' + response.header.status);
        callback && callback();
      }
    });
    serv.write(buf);
  }
}

// Closes connections to all the servers.
Client.prototype.close = function() {
  for (i in this.servers) {
    this.servers[i].close();
  }
}

exports.Client = Client;
exports.Server = Server;
