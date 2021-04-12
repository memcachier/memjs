const test = require('tap').test;
const MemJS = require('../memjs/memjs');
const makeRequestBuffer = require('../memjs/utils').makeRequestBuffer;

test('AuthListMechanisms', function(t) {
  const expectedBuf = makeRequestBuffer(0x20, '', '', '');
  const dummySocket = {
    write: function(buf) {
      t.equal(expectedBuf.toString(), buf.toString());
    }
  };
  const server = new MemJS.Server('test.example.com', 11211);
  server._socket = dummySocket;
  server.listSasl();
  t.end();
});


test('ResponseHandler with authentication error', function(t) {
  const server = new MemJS.Server('localhost', 11211);

  server.onError('test', function(err) {
    t.equal('Memcached server authentication failed!', err.message);
  });

  // Simulate a memcached server response, with an authentication error
  // No SASL configured, wrong credentials, ...
  const responseBuf = makeRequestBuffer(0x21, '', '', '');
  // Override status
  // 0x20 = Authentication required / Not Successful
  responseBuf.writeUInt16BE(0x20, 6);

  server.responseHandler(responseBuf);

  t.end();
});

test('Authenticate', function(t) {
  const expectedBuf = makeRequestBuffer(0x21, 'PLAIN', '', '\0user1\0password');
  const dummySocket = {
    write: function(buf) {
      t.equal(expectedBuf.toString(), buf.toString());
    }
  };
  const server = new MemJS.Server('test.example.com', 11211, 'user1', 'password', {});
  server._socket = dummySocket;
  server.saslAuth();
  t.end();
});

test('SetSaslCredentials', function(t) {
  let server;
  server = new MemJS.Server('test.example.com', 11211, undefined,
    undefined, {username: 'user1', password: 'password'});
  t.equal('user1', server.username);
  t.equal('password', server.password);

  server = new MemJS.Server('test.example.com', 11211, 'user2',
    'password2', {username: 'user1', password: 'password'});
  t.equal('user2', server.username);
  t.equal('password2', server.password);

  server = new MemJS.Server('test.example.com', 11211);
  t.equal(process.env.MEMCACHIER_USERNAME ||
                process.env.MEMCACHE_USERNAME, server.username);
  t.equal(process.env.MEMCACHIER_PASSWORD ||
                process.env.MEMCACHE_PASSWORD, server.password);
  t.end();
});

test('ResponseCallbackOrdering', function(t) {
  const server = new MemJS.Server();
  let callbacksCalled = 0;

  server.onResponse(1, function() {
    t.equal(0, callbacksCalled);
    callbacksCalled += 1;
  });
  server.respond({header: {opaque: 1}});

  server.onResponse(2, function() {
    t.equal(1, callbacksCalled);
    callbacksCalled += 1;
  });

  server.onResponse(3, function() {
    t.equal(2, callbacksCalled);
    callbacksCalled += 1;
  });

  server.respond({header: {opaque: 2}});
  server.respond({header: {opaque: 3}});
  t.end();
});
