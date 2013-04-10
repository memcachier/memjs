var errors = require('./protocol').errors;
var Server = require('./server').Server;
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var hashCode = require('./utils').hashCode;
var merge = require('./utils').merge;
var makeExpiration = require('./utils').makeExpiration;

// Client initializer takes a list of Servers.
var Client = function(servers, options) {
  this.servers = servers;
  this.seq = 0;
  this.options = merge(options || {}, {retries: 2, expires: 0, logger: console});
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
// The options hash may contain the options:
// * `retries` - the number of times to retry an operation in lieu of failures (default 2)
// * `expires` - the default expiration to use (default 0 - never expire)
// Or options for the servers including:
// * `username` and `password` for SASL authentication.
// * `timeout` in seconds to determine failure for operations
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
// callback is invoked with the arguments _error_ (optional), _value_,
// _extras_, both Buffers. If the key is not found, the callback is invoked
// with null for both arguments. If there is a different error, the error
// is logged and passed to the callback.
Client.prototype.get = function(key, callback) {
  this.seq++;
  var request = makeRequestBuffer(0, key, '', '', this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case  0:
      callback && callback(null, response.val, response.extras)
      break;
    case 1:
      callback && callback(null, null, null);
      break;
    default:
      var errorMessage = 'MemJS GET: ' + errors[response.header.status];
      logger.log(errorMessage);
      callback && callback(new Error(errorMessage), null, null);
    }
  });
}

// SET
//
// Takes a key and value to put to memcache and a callback. The success of the
// operation is signaled through the argument to the callback. The last argument is
// an optional expiration which overrides the default expiration
Client.prototype.set = function(key, value, callback, expires) {
  var extras = Buffer.concat([new Buffer('00000000', 'hex'),
                              makeExpiration(expires || this.options.expires)]);
  this.seq++;
  var request = makeRequestBuffer(1, key, extras, value, this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case 0:
      callback && callback(null, true)
      break;
    default:
      var errorMessage = 'MemJS SET: ' + errors[response.header.status];
      logger.log(errorMessage);
      callback && callback(new Error(errorMessage), null, null);
    }
  });
}

// ADD
//
// Takes a key and value to put to memcache and a callback. An error is passed as
// the first argument to the callback and the success of the operation is signaled
// through the second argument to the callback. The operation
// only succeeds if the key is not already present in the cache.
Client.prototype.add = function(key, value, callback, expires) {
  var extras = Buffer.concat([new Buffer('00000000', 'hex'), makeExpiration(expires || this.options.expires)]);
  this.seq++;
  var request = makeRequestBuffer(2, key, extras, value, this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case 0:
      callback && callback(null, true)
      break;
    case 2:
      callback && callback(null, false);
      break;
    default:
      var errorMessage = 'MemJS ADD: ' + errors[response.header.status];
      logger.log(errorMessage, false);
      callback && callback(new Error(errorMessage), null, null);
    }
  });
}

// REPLACE
//
// Takes a key and value to put to memcache and a callback. An error is passed as
// the first argument to the callback and the success of the operation is signaled
// through the second argument to the callback. The operation
// only succeeds if the key is already present in the cache.
Client.prototype.replace = function(key, value, callback, expires) {
  var extras = Buffer.concat([new Buffer('00000000', 'hex'), makeExpiration(expires || this.options.expires)]);
  this.seq++;
  var request = makeRequestBuffer(3, key, extras, value, this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case 0:
      callback && callback(null, true)
      break;
    case 1:
      callback && callback(null, false);
      break;
    default:
      var errorMessage = 'MemJS REPLACE: ' + errors[response.header.status];
      logger.log(errorMessage, false);
      callback && callback(new Error(errorMessage), null, null);
    }
  });
}

// DELETE
//
// Takes a key to delete from memcache and a callback. An error is passed as
// the first argument to the callback and the success of the
// operation is signaled through the argument to the callback.
Client.prototype.delete = function(key, callback) {
  this.seq++;
  var request = makeRequestBuffer(4, key, '', '', this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(response) {
    switch (response.header.status) {
    case  0:
      callback && callback(null, true)
      break;
    case 1:
      callback && callback(null, false);
      break;
    default:
      var errorMessage = 'MemJS DELETE: ' + errors[response.header.status];
      logger.log(errorMessage, false);
      callback && callback(new Error(errorMessage), null);
    }
  });
}

// FLUSH
//
// Flushes the cache for each connected server. Returns an error in the first
// argument if any of the servers fail and signals the success of the operation
// in the second argument.
Client.prototype.flush = function(callback) {
  this.seq++;
  var request = makeRequestBuffer(0x08, '', '', '', this.seq);
  var result = true;
  for (i in this.servers) {
    var serv = this.servers[i];
    serv.onResponse(this.seq, function statsHandler(response) {
        callback && callback(null, result);
    });
    serv.onError(this.seq, function(err) {
      callback && callback(err, false);
    });
    serv.write(request);
  }
}

// STATS
//
// Invokes the callback for each server with the server name (a string of the
// format [hostname]:[port]) a dictionary of statistics from each server.
Client.prototype.stats = function(callback) {
  this.seq++;
  var request = makeRequestBuffer(0x10, '', '', '', this.seq);
  var logger = this.options.logger;
  for (i in this.servers) {
    var serv = this.servers[i];
    var result = {};
    var statsHandler = function(response) {
      if (response.header.totalBodyLength == 0) {
        callback && callback(null, serv.host + ":" + serv.port, result);
        return;
      }
      switch (response.header.status) {
      case  0:
        result[response.key.toString()] = response.val.toString();
        break;
      default:
        logger.log('MemJS STATS: ' + response.header.status);
        callback && callback();
        var errorMessage = 'MemJS DELETE: ' + errors[response.header.status];
        logger.log(errorMessage, false);
        callback && callback(new Error(errorMessage, serv.host + ":" + serv.port, null));
      }
    };
    statsHandler.quiet = true;
    serv.onResponse(this.seq, statsHandler);
    serv.onError(this.seq, function(err) {
      callback && callback(err, serv.host + ":" + serv.port, null);
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
  var logger = this.options.logger;

  var responseHandler = function(response) {
    callback && callback(response);
  };

  var errorHandler = function(error) {
    if (--retries > 0) {
      serv.onResponse(this.seq, responseHandler);
      serv.onError(this.seq, errorHandler);
      serv.write(request);
    } else {
      logger.log("MemJS: Server <" + serv.host + ":" + serv.port +
                  "> failed after (" + origRetries +
                  ") retries with error - " + error.message);
    }
  };

  serv.onResponse(this.seq, responseHandler);
  serv.onError(this.seq, errorHandler);
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
exports.Utils = require('./utils');
exports.Header = require('./header');

