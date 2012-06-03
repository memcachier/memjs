var errors = require('./protocol').errors;
var Server = require('./server').Server;
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var hashCode = require('./utils').hashCode;
var merge = require('./utils').merge;

// Client initializer takes a list of Servers.
var Client = function(servers, options) {
  this.servers = servers;
  this.options = merge(options || {}, {retries: 2, expires: 0, timeout: 0.5});
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
  serversStr = serversStr || process.env.MEMCACHIER_SERVERS
                          || process.env.MEMCACHE_SERVERS || "localhost:11211";
  var serverUris = serversStr.split(",");
  var servers = serverUris.map(function(uri) {
    var uriParts = uri.split(":");
    return new Server(uriParts[0], parseInt(uriParts[1] || 11211), options);
  });
  return new Client(servers, options);
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
  var request = makeRequestBuffer(0, key, '', '');
  var serv = this.server(key);
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case  0:
      callback && callback(response.val, response.extras)
      break;
    case 1:
      callback && callback(null, null);
      break;
    default:
      console.log('MemJS GET: ' + errors[response.header.status]);
      callback && callback();
    }
  });
}

// SET
//
// Takes a key and value to put to memcache and a callback. The success of the
// operation is signaled through the argument to the callback.
Client.prototype.set = function(key, value, callback) {
  var request = makeRequestBuffer(1, key, '\0\0\0\0\0\0\0\0', value);
  var serv = this.server(key);
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case 0:
      callback && callback(true)
      break;
    default:
      console.log('MemJS SET: ' + errors[response.header.status]);
      callback && callback();
    }
  });
}

// ADD
//
// Takes a key and value to put to memcache and a callback. The success of the
// operation is signaled through the argument to the callback. The operation
// only succeeds if the key is not already present in the cache.
Client.prototype.add = function(key, value, callback) {
  var request = makeRequestBuffer(2, key, '\0\0\0\0\0\0\0\0', value);
  var serv = this.server(key);
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case 0:
      callback && callback(true)
      break;
    case 2:
      callback && callback(false);
      break;
    default:
      console.log('MemJS ADD: ' + errors[response.header.status]);
      callback && callback();
    }
  });
}

// REPLACE
//
// Takes a key and value to put to memcache and a callback. The success of the
// operation is signaled through the argument to the callback. The operation
// only succeeds if the key is already present in the cache.
Client.prototype.replace = function(key, value, callback) {
  var request = makeRequestBuffer(3, key, '\0\0\0\0\0\0\0\0', value);
  var serv = this.server(key);
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case 0:
      callback && callback(true)
      break;
    case 1:
      callback && callback(false);
      break;
    default:
      console.log('MemJS REPLACE: ' + errors[response.header.status]);
      callback && callback();
    }
  });
}

// DELETE
//
// Takes a key to delete from memcache and a callback. The success of the
// operation is signaled through the argument to the callback.
Client.prototype.delete = function(key, callback) {
  var request = makeRequestBuffer(4, key, '', '');
  var serv = this.server(key);
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case  0:
      callback && callback(true)
      break;
    case 1:
      callback && callback(false);
      break;
    default:
      console.log('MemJS DELETE: ' + errors[response.header.status]);
      callback && callback();
    }
  });
}

// STATS
//
// Invokes the callback with a dictionary of statistics from each server.
Client.prototype.stats = function(callback) {
  var request = makeRequestBuffer(0x10, '', '', '');
  var result = {};
  for (i in this.servers) {
    var serv = this.servers[i];
    serv.on('response', function statsHandler(response) {
      if (response.header.totalBodyLength == 0) {
        serv.removeListener('response', statsHandler);
        callback && callback(serv.host + ":" + serv.port, result);
        return;
      }
      switch (response.header.status) {
      case  0:
        result[response.key.toString()] = response.val.toString();
        break;
      default:
        console.log('MemJS STATS: ' + response.header.status);
        callback && callback();
      }
    });
    serv.on('error', function() {
      callback && callback(serv.host + ":" + serv.port, null);
    });
    serv.write(request);
  }
}

// Perform a generic single response operation (get, set etc) on a server
// serv: the server to perform the operation on
// request: a buffer containing the request
// callback
Client.prototype.perform = function(serv, request, callback, retries) {
  retries = retries || this.options.retries
  origRetries = retries;
  var errorHandler = function(error) {
    if (--retries > 0) {
      serv.write(request);
    } else {
      serv.removeListener('error', errorHandler);
      serv.removeListener('response', responseHandler);
      console.log("MemJS: Server <" + serv.host + ":" + serv.port +
                  "> failed after (" + origRetries +
                  ") retries with error - " + error.message);
    }
  };
  
  var responseHandler = function(response) {
    serv.removeListener('error', errorHandler);
    callback && callback(response);
  };
  
  serv.once('response', responseHandler);
  serv.on('error', errorHandler);
  serv.write(request);
}

// Closes connections to all the servers.
Client.prototype.close = function() {
  for (i in this.servers) {
    this.servers[i].close();
  }
}

exports.Client = Client;
exports.Server = Server;
