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
  var server = new MemJS.Server('test.example.comr', 11211, opts);
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
  var server = new MemJS.Server('test.example.comr', 11211, opts);
  server._socket = dummySocket;
  server.saslAuth();
}

