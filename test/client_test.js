var errors = require('protocol').errors;
var MemJS = require('memjs');

exports.testGetSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.respond(
      {header: {status: 0, opaque: request.header.opaque},
        val: 'world', extras: 'flagshere'});
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

exports.testGetNotFound = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.respond(
      {header: {status: 1, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    assert.equal('\0\0\0\0\0\0\4\0', request.extras.toString());
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.respond({header: {status: 3, opaque: request.header.opaque}});
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

exports.testSetError = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.error({message: "This is an expected error."});
  }

  var client = new MemJS.Client([dummyServer]);
  client.set('hello', 'world', function(err, val) {
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(2, n,  'Ensure set is retried once');
    assert.equal(0, callbn,  'Ensure callback is called');
  });
}

exports.testSetUnicode = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('éééoào', request.val);
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    assert.equal('\0\0\0\0\0\0\4\0', request.extras.toString());
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.respond({header: {status: 2, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    assert.equal('\0\0\0\0\0\0\4\0', request.extras.toString());
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    assert.equal('world', request.val);
    n += 1;
    dummyServer.respond({header: {status: 1, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal('hello', request.key);
    n += 1;
    dummyServer.respond({header: {status: 1, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(0x08, request.header.opcode);
    n += 1;
    dummyServer.respond({header: {status: 1, opaque: request.header.opaque}});
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
  var dummyServer = new MemJS.Server();
  dummyServer.host = "myhostname";
  dummyServer.port = 5544
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(0x10, request.header.opcode);
    n += 1;
    dummyServer.respond({header: {status: 0, totalBodyLength: 9,
                                  opaque: request.header.opaque},
                        key: 'bytes', val: '1432'});
    dummyServer.respond({header: {status: 0, totalBodyLength: 9,
                                  opaque: request.header.opaque},
                        key: 'count', val: '5432'});
    dummyServer.respond({header: {status: 0, totalBodyLength: 0,
                                  opaque: request.header.opaque}});
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

