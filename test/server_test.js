var errors = require('protocol').errors;
var MemJS = require('memjs');
var events = require('events');
var makeRequestBuffer = require('../lib/memjs/utils').makeRequestBuffer;

exports.testAuthListMechanisms = function(beforeExit, assert) {
  var expectedBuf = makeRequestBuffer(0x20, '', '', '');
  var dummySocket =
    { write: function(buf) {
        assert.equal(expectedBuf.toString(), buf.toString());
      }
    };
  var opts = {username: 'user1', password: 'password'};
  var server = new MemJS.Server('test.example.com', 11211, opts);
  server._socket = dummySocket;
  server.listSasl();
}

exports.testAuthenticate = function(beforeExit, assert) {
  var expectedBuf = makeRequestBuffer(0x21, 'PLAIN', '',
        '\0user1\0password');
  var dummySocket =
    { write: function(buf) {
        assert.equal(expectedBuf.toString(), buf.toString());
      }
    };
  var opts = {username: 'user1', password: 'password'};
  var server = new MemJS.Server('test.example.com', 11211, opts);
  server._socket = dummySocket;
  server.saslAuth();
}

exports.testResponseCallbackOrdering = function(beforeExit, assert) {
  var server = new MemJS.Server();
  var callbacksCalled = 0;

  server.onResponse(1, function() {
    assert.equal(0, callbacksCalled);
    callbacksCalled += 1;
  });
  server.respond({header: {opaque: 1}});

  server.onResponse(2, function() {
    assert.equal(1, callbacksCalled);
    callbacksCalled += 1;
  });

  server.onResponse(3, function() {
    assert.equal(2, callbacksCalled);
    callbacksCalled += 1;
  });

  server.respond({header: {opaque: 2}});
  server.respond({header: {opaque: 3}});
}
