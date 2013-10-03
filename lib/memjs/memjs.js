// # MemJS Memcache Client

var errors = require('./protocol').errors;
var Server = require('./server').Server;
var makeRequestBuffer = require('./utils').makeRequestBuffer;
var hashCode = require('./utils').hashCode;
var merge = require('./utils').merge;
var makeExpiration = require('./utils').makeExpiration;
var makeAmountInitialAndExpiration = require('./utils').makeAmountInitialAndExpiration;

// Client initializer takes a list of `Server`s and an `options` dictionary.
// See `Client.create` for details.
var Client = function(servers, options) {
  this.servers = servers;
  this.seq = 0;
  this.options = merge(options || {}, {retries: 2, expires: 0, logger: console});
}

// Creates a new client given an optional config string and optional hash of
// options. The config string should be of the form:
//
//     "[user:pass@]server1[:11211],[user:pass@]server2[:11211],..."
//
// If the argument is not given, fallback on the `MEMCACHIER_SERVERS` environment
// variable, `MEMCACHE_SERVERS` environment variable or `"localhost:11211"`.
//
// The options hash may contain the options:
//
// * `retries` - the number of times to retry an operation in lieu of failures
// (default 2)
// * `expires` - the default expiration in seconds to use (default 0 - never
// expire). If `expires` is greater than 30 days (60 x 60 x 24 x 30), it is
// treated as a UNIX time (number of seconds since January 1, 1970).
// * `logger` - a logger object that responds to
//   
//   ~~~~
//     log(msg1[, msg2[, msg3[...]]])
//   ~~~~
//
//   Defaults to `console`.
//
// Or options for the servers including:
// * `username` and `password` for fallback SASL authentication credentials.
// * `timeout` in seconds to determine failure for operations
Client.create = function(serversStr, options) {
  serversStr = serversStr || process.env.MEMCACHIER_SERVERS
                          || process.env.MEMCACHE_SERVERS || "localhost:11211";
  var serverUris = serversStr.split(",");
  var servers = serverUris.map(function(uri) {
    var uriParts = uri.split("@");
    var hostPort = uriParts[uriParts.length - 1].split(":");
    var userPass = (uriParts[uriParts.length - 2] || "").split(":");
    return new Server(hostPort[0], parseInt(hostPort[1] || 11211), userPass[0], userPass[1], options);
  });
  return new Client(servers, options);
}

// Chooses the server to talk to by hashing the given key.
// TODO(alevy): should use consistent hashing and/or allow swaping hashing
// mechanisms
Client.prototype.server = function(key) {
  return this.servers[hashCode(key) % this.servers.length];
}

// ## Memcache Commands
//
// All commands return their results through a callback passed as the last
// required argument (some commands, like `Client#set`, take optional arguments
// after the callback).
//
// The callback signature always follows:
//
//     callback(err, [arg1[, arg2[, arg3[...]]]])
//
// In case of an error the _err_ argument will be non-null and contain the
// `Error`. A notable exception includes a `Client#get` on a key that doesn't
// exist. In this case, _err_ will be null, as will the _value and _extras_
// arguments.

// GET
//
// Fetches the value at the given key with callback signature:
//
//     callback(err, value, key)
//
// _value_ and _key_ are both `Buffer`s.
// If the key is not found, the callback is invoked
// with null for both arguments and no error.
Client.prototype.get = function(key, callback) {
  this.seq++;
  var request = makeRequestBuffer(0, key, '', '', this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null, null);
      return;
    }
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
// Sets the given _key_ and _value_ in memcache. The _expires_ argument (passed
// in last, after the callback) overrides the default expiration (see
// `Client.create`). The callback signature is:
//
//     callback(err, success)
Client.prototype.set = function(key, value, callback, expires) {
  var extras = Buffer.concat([new Buffer('00000000', 'hex'),
                              makeExpiration(expires || this.options.expires)]);
  this.seq++;
  var request = makeRequestBuffer(1, key, extras, value.toString(), this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null);
      return;
    }
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
// Adds the given _key_ and _value_ to memcache. The operation only succeeds
// if the key is not already set. The _expires_ argument (passed
// in last, after the callback) overrides the default expiration (see
// `Client.create`). The callback signature is:
//
//     callback(err, success)
Client.prototype.add = function(key, value, callback, expires) {
  var extras = Buffer.concat([new Buffer('00000000', 'hex'), makeExpiration(expires || this.options.expires)]);
  this.seq++;
  var request = makeRequestBuffer(2, key, extras, value.toString(), this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null, null);
      return;
    }
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
// Replaces the given _key_ and _value_ to memcache. The operation only succeeds
// if the key is already present. The _expires_ argument (passed
// in last, after the callback) overrides the default expiration (see
// `Client.create`). The callback signature is:
//
//     callback(err, success)
Client.prototype.replace = function(key, value, callback, expires) {
  var extras = Buffer.concat([new Buffer('00000000', 'hex'), makeExpiration(expires || this.options.expires)]);
  this.seq++;
  var request = makeRequestBuffer(3, key, extras, value.toString(), this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null, null);
      return;
    }
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
// Deletes the given _key_ from memcache. The operation only succeeds
// if the key is already present. The callback signature is:
//
//     callback(err, success)
Client.prototype.delete = function(key, callback) {
  this.seq++;
  var request = makeRequestBuffer(4, key, '', '', this.seq);
  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null, null);
      return;
    }
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

// INCREMENT
//
// Increments the given _key_ in memcache. Defaults to `0` if the key is not
// present. The _expires_ argument (passed
// in last, after the callback) overrides the default expiration (see
// `Client.create`). The callback signature is:
//
//     callback(err, success)
Client.prototype.increment = function(key, amount, callback, expires) {
  var extras = makeAmountInitialAndExpiration(amount, 0, (expires || this.options.expires));
  this.seq++;
  var request = makeRequestBuffer(5, key, extras, '', this.seq);

  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null);
      return;
    }
    switch (response.header.status) {
    case 0:
      callback && callback(null, true)
      break;
    default:
      var errorMessage = 'MemJS INCREMENT: ' + errors[response.header.status];
      logger.log(errorMessage);
      callback && callback(new Error(errorMessage), null);
    }
  });
}

// DECREMENT
//
// Decrements the given _key_ in memcache. Defaults to `0` if the key is not
// present. The _expires_ argument (passed
// in last, after the callback) overrides the default expiration (see
// `Client.create`). The callback signature is:
//
//     callback(err, success)
Client.prototype.decrement = function(key, amount, callback, expires) {
  var extras = makeAmountInitialAndExpiration(amount, 0, (expires || this.options.expires));
  this.seq++;
  var request = makeRequestBuffer(6, key, extras, '', this.seq);

  var serv = this.server(key);
  var logger = this.options.logger;
  this.perform(serv, request, function(err, response) {
    if (err) {
      callback(err, null);
      return;
    }
    switch (response.header.status) {
    case 0:
      callback && callback(null, true)
      break;
    default:
      var errorMessage = 'MemJS DECREMENT: ' + errors[response.header.status];
      logger.log(errorMessage);
      callback && callback(new Error(errorMessage), null);
    }
  });
}

// FLUSH
//
// Flushes the cache on each connected server. The callback signature is:
//
//     callback(lastErr, results)
//
// where _lastErr_ is the last error encountered (or null, in the common case
// where there were no errors). _results_ is a dictionary mapping
// `"hostname:port"` to either `true` (if the operation was successful), or an
// error.
Client.prototype.flush = function(callback) {
  this.seq++;
  var request = makeRequestBuffer(0x08, '', '', '', this.seq);
  var result = {};
  var count = 0;
  var lastErr = null;
  var servers = this.servers;
  for (i in this.servers) {
    var serv = servers[i];
    serv.onResponse(this.seq, function(response) {
      count += 1;
      result[serv.host + ":" + serv.port] = true;
      if (callback && count >= servers.length) {
        callback(lastErr, result);
      }
    });
    serv.onError(this.seq, function(err) {
      lastErr = err;
      count += 1;
      result[serv.host + ":" + serv.port] = err;
      if (callback && count >= servers.length) {
        callback(lastErr, result);
      }
    });
    serv.write(request);
  }
}

// STATS
//
// Fetches memcache stats from each connected server. The callback is invoked 
// **ONCE PER SERVER** and has the signature:
//
//     callback(err, server, stats)
//
// _server_ is the `"hostname:port"` of the server, and _stats_ is a
// dictionary mapping the stat name to the value of the statistic as a string.
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
    callback && callback(null, response);
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
      callback && callback(error, null);
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

