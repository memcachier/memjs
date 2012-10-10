var errors = require('protocol').errors;
var MemJS = require('memjs');
var util = require('util');
var events = require('events');

function DummyServer()
{
  events.EventEmitter.call(this);
  this.responseCallbacks = new Array();
  this.on('response', function(response) {
    if (this.responseCallbacks.length > 0) {
      var firstCallback = this.responseCallbacks.splice(0,1)[0];
      firstCallback(response);
    }
  }.bind(this));
}
util.inherits(DummyServer, events.EventEmitter);
DummyServer.prototype.write = function(blob, callback) {
  if (callback)
    this.responseCallbacks.push(callback);

  this.handleWrite(blob);
}
DummyServer.prototype.handleWrite = function(requestBuf){};



exports.testGetSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.emit('response',
      {header: {status: 0}, val: 'world', extras: 'flagshere'});
  }

  var client = new MemJS.Client([dummyServer]);
  client.get('hello', function(err, val, flags) {
    assert.equal('world', val);
    assert.equal('flagshere', flags);
    assert.equal(null, err);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testSynchronous = function(beforeExit, assert) {
  
  var n = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    var key = request.key.toString();
    setTimeout(function() {
      if (key == "key1")
      {
        dummyServer.emit('response',
          {header: {status: 0}, val: 'value1', extras: 'flagshere'});
      }
      if (key == "key2")
      {
        dummyServer.emit('response',
          {header: {status: 0}, val: 'value2', extras: 'flagshere'});
      }
    },100);
  }

  var responses = 0;
  var client = new MemJS.Client([dummyServer]);
  client.get("key1", function(err, response) {
    responses++;
    assert.equal(response, "value1");
  });
  client.get("key2", function(err, response) {
    responses++;
    assert.equal(response, "value2");
  });

  beforeExit(function() {
    assert.equal(2, responses,  'Ensure callback is called');
  });
}

exports.testGetNotFound = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
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
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.set('hello', 'world', function(err, val) {
    assert.equal(true, val);
    assert.equal(null, err);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testSetWithExpiration = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    assert.equal('\0\0\0\0\0\0\4\0', request.extras.toString());
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }

  var client = new MemJS.Client([dummyServer], {expires: 1024});
  client.set('hello', 'world', function(err, val) {
    assert.equal(null, err);
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
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.emit('response', {header: {status: 3}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.set('hello', 'world', function(err, val) {
    assert.equal(undefined, val);
    assert.equal("MemJS SET: " + errors[3], err.message);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testSetUnicode = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('éééoào', request.val);
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }
  
  var client = new MemJS.Client([dummyServer]);
  client.set('hello', 'éééoào', function(err, val) {
    assert.equal(true, val);
    callbn += 1;
  });
  
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testAddSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    assert.equal('\0\0\0\0\0\0\4\0', request.extras.toString());
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }

  var client = new MemJS.Client([dummyServer], {expires: 1024});
  client.add('hello', 'world', function(err, val) {
    assert.equal(null, err);
    assert.equal(true, val);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testAddKeyExists = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.emit('response', {header: {status: 2}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.add('hello', 'world', function(err, val) {
    assert.equal(null, err);
    assert.equal(false, val);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testReplaceSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    assert.equal('\0\0\0\0\0\0\4\0', request.extras.toString());
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }

  var client = new MemJS.Client([dummyServer], {expires: 1024});
  client.replace('hello', 'world', function(err, val) {
    assert.equal(null, err);
    assert.equal(true, val);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testReplaceKeyDNE = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.emit('response', {header: {status: 1}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.replace('hello', 'world', function(err, val) {
    assert.equal(null, err);
    assert.equal(false, val);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testDeleteSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.emit('response', {header: {status: 0}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.delete('hello', function(err, val) {
    assert.equal(null, err);
    assert.equal(true, val);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testDeleteKeyDNE = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.emit('response', {header: {status: 1}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.delete('hello', function(err, val) {
    assert.equal(null, err);
    assert.equal(false, val);
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(1, n,  'Ensure set is called');
    assert.equal(1, callbn,  'Ensure callback is called');
  });
}

exports.testFlush = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(0x08, request.header.opcode);
    n += 1;
    dummyServer.emit('response', {header: {status: 1}});
  }

  var client = new MemJS.Client([dummyServer, dummyServer]);
  client.flush(function(err, val) {
    assert.equal(null, err);
    assert.equal(true, val);
  });

}

exports.testStats = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new DummyServer();
  dummyServer.host = "myhostname";
  dummyServer.port = 5544
  dummyServer.handleWrite = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(0x10, request.header.opcode);
    n += 1;
    dummyServer.emit('response', {header: {status: 0}, key: 'bytes', val: '1432'});
    dummyServer.emit('response', {header: {status: 0}, key: 'count', val: '5432'});
    dummyServer.emit('response', {header: {status: 0, totalBodyLength: 0}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.stats(function(err, server, stats) {
    assert.equal(null, err);
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

