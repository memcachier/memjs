var MemJS = require('../client');
var events = require('events');
var utils = require('../utils');

exports.testGetSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new events.EventEmitter();
  dummyServer.write = function(requestBuf) {
    request = utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.emit('response',
      {header: {status: 0}, value: 'world', extras: 'flagshere'});
  }
  
  var client = new MemJS.Client([dummyServer]);
  client.get('hello', function(val, flags) {
    assert.equal('world', val);
    assert.equal('flagshere', flags);
    callbn += 1;
  });
  
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testGetNotFound = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new events.EventEmitter();
  dummyServer.write = function(requestBuf) {
    request = utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.emit('response',
      {header: {status: 1}});
  }
  
  var client = new MemJS.Client([dummyServer]);
  client.get('hello', function(val, flags) {
    assert.equal(null, val);
    assert.equal(null, flags);
    callbn += 1;
  });
  
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testSetSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new events.EventEmitter();
  dummyServer.write = function(requestBuf) {
    request = utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.value);
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }
  
  var client = new MemJS.Client([dummyServer]);
  client.set('hello', 'world', function(val) {
    assert.equal(true, val);
    callbn += 1;
  });
  
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testSetUnsuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new events.EventEmitter();
  dummyServer.write = function(requestBuf) {
    request = utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.value);
    n += 1;
    dummyServer.emit('response', {header: {status: 3}});
  }
  
  var client = new MemJS.Client([dummyServer]);
  client.set('hello', 'world', function(val) {
    assert.equal(undefined, val);
    callbn += 1;
  });
  
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testStats = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new events.EventEmitter();
  dummyServer.host = "myhostname";
  dummyServer.port = 5544
  dummyServer.write = function(requestBuf) {
    request = utils.parseMessage(requestBuf);
    assert.equal(0x10, request.header.opcode);
    n += 1;
    dummyServer.emit('response', {header: {status: 0}, key: 'bytes', value: '1432'});
    dummyServer.emit('response', {header: {status: 0}, key: 'count', value: '5432'});
    dummyServer.emit('response', {header: {status: 0, totalBodyLength: 0}});
  }
  
  var client = new MemJS.Client([dummyServer]);
  client.stats(function(server, stats) {
    assert.equal('1432', stats.bytes);
    assert.equal('5432', stats.count);
    assert.equal('myhostname:5544', server);
    callbn += 1;
  });
  
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}
