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
    assert.equal(1, callbn,  'Ensure callback is called ' + callbn);
  });
}

exports.testSetError = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var errn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    setTimeout(function() {
      request = MemJS.Utils.parseMessage(requestBuf);
      assert.equal('hello', request.key);
      assert.equal('world', request.val);
      n += 1;
      dummyServer.error({message: "This is an expected error."});
    }, 100);
  }

  var client = new MemJS.Client([dummyServer], {retries: 2});
  client.set('hello', 'world', function(err, val) {
    if (err) {
      errn += 1;
    }
    callbn += 1;
  });

  beforeExit(function() {
    assert.equal(2, n,  'Ensure set is retried once ' + n);
    assert.equal(1, callbn,  'Ensure callback is called ' + callbn);
    assert.equal(1, errn,  'Ensure callback called with error ' + errn);
  });
}

exports.testSetErrorConcurrent = function(beforeExit, assert) {
  var n = 0;
  var callbn1 = 0;
  var errn1 = 0;
  var callbn2 = 0;
  var errn2 = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    setTimeout(function() {
      request = MemJS.Utils.parseMessage(requestBuf);
      n += 1;
      dummyServer.error({message: "This is an expected error."});
    }, 100);
  }

  var client = new MemJS.Client([dummyServer], {retries: 2});
  client.set('hello', 'world', function(err, val) {
    if (err) {
      errn1 += 1;
    }
    callbn1 += 1;
  });

  client.set('foo', 'bar', function(err, val) {
    if (err) {
      errn2 += 1;
    }
    callbn2 += 1;
  });

  beforeExit(function() {
    assert.equal(4, n,  'Ensure set is retried once ' + n);
    assert.equal(1, callbn1,  'Ensure callback is called ' + callbn1);
    assert.equal(1, errn1,  'Ensure callback called with error ' + errn1);
    assert.equal(1, callbn2,  'Ensure callback is called ' + callbn2);
    assert.equal(1, errn2,  'Ensure callback called with error ' + errn2);
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
  dummyServer.host = "example.com";
  dummyServer.port = 1234;
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(0x08, request.header.opcode);
    n += 1;
    dummyServer.respond({header: {status: 1, opaque: request.header.opaque}});
  }

  var client = new MemJS.Client([dummyServer, dummyServer]);
  client.flush(function(err, results) {
    assert.equal(null, err);
    assert.equal(true, results['example.com:1234']);
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

exports.testIncrementSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(5, request.header.opcode);
    assert.equal('number-increment-test', request.key);
    assert.equal('', request.val);
    assert.equal('\0\0\0\0\0\0\0\5\0\0\0\0\0\0\0\0\0\0\0\0',
                 request.extras.toString());
    n += 1;
    var value = new Buffer(8);
    value.writeUInt32BE(request.header.opcode + 1, 4);
    value.writeUInt32BE(0, 0);
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}, val: value});
  }

  var client = new MemJS.Client([dummyServer]);
  client.increment('number-increment-test', 5, function(err, success, val){
    callbn += 1;
    assert.equal(true, success);
    assert.equal(6, val);
    assert.equal(null, err);
  });

  beforeExit(function() {
    assert.equal(1, callbn,  'Ensure callbacks are called');
    assert.equal(1, n,       'Ensure incr is called');
  });
}

exports.testDecrementSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new MemJS.Server();
  dummyServer.write = function(requestBuf) {
    request = MemJS.Utils.parseMessage(requestBuf);
    assert.equal(6, request.header.opcode);
    assert.equal('number-decrement-test', request.key);
    assert.equal('', request.val);
    assert.equal('\0\0\0\0\0\0\0\5\0\0\0\0\0\0\0\0\0\0\0\0',
                 request.extras.toString());
    n += 1;
    dummyServer.respond({header: {status: 0, opaque: request.header.opaque}});
  }

  var client = new MemJS.Client([dummyServer]);
  client.decrement('number-decrement-test', 5, function(err, val){
    callbn += 1;
    assert.equal(true, val);
    assert.equal(null, err);
  });

  beforeExit(function() {
    assert.equal(1, callbn,  'Ensure callbacks are called');
    assert.equal(1, n,       'Ensure decr is called');
  });
}

exports.testFailover = function(beforeExit, assert) {
  var n1 = 0;
  var n2 = 0;
  var dummyServer1 = new MemJS.Server();
  dummyServer1.write = function(requestBuf) {
    n1 += 1;
    dummyServer1.error(new Error("connection failure"));
  }
  var dummyServer2 = new MemJS.Server();
  dummyServer2.write = function(requestBuf) {
    n2 += 1;
    dummyServer2.respond({header: {status: 0, opaque: request.header.opaque}});
  }

  var client = new MemJS.Client([dummyServer1, dummyServer2],
        {failover: true});
  client.get('\0', function(err, val){
    assert.equal(null, err);
  });

  beforeExit(function() {
    assert.equal(2, n1);
    assert.equal(1, n2);
  });
}

/*
exports.testFailoverRecovery = function(beforeExit, assert) {
  Date.now = function() { return 1; }
  var n1 = 0;
  var n2 = 0;
  var dummyServer1 = new MemJS.Server();
  dummyServer1.write = function(requestBuf) {
    n1 += 1;
    dummyServer1.error(new Error("connection failure"));
  }
  var dummyServer2 = new MemJS.Server();
  dummyServer2.write = function(requestBuf) {
    n2 += 1;
    dummyServer2.respond({header: {status: 0, opaque: request.header.opaque}});
  }

  var client = new MemJS.Client([dummyServer1, dummyServer2],
        {failover: true});
  client.get('\0', function(err, val){
    assert.equal(null, err);
  });

  dummyServer1.write = function(requestBuf) {
    n1 += 1;
    dummyServer1.respond({header: {status: 0, opaque: request.header.opaque}});
  }

  client.get('\0', function(err, val){
    assert.equal(null, err);
  });

  Date.now = function() {
    return 60001;
  }

  client.get('\0', function(err, val){
    assert.equal(null, err);
  });

  beforeExit(function() {
    assert.equal(3, n1);
    assert.equal(2, n2);
  });
}
*/
