var MemJS = require('../client');
var events = require('events');
var utils = require('../utils');

exports.testSetSuccessful = function(beforeExit, assert) {
  var n = 0;
  var callbn = 0;
  var dummyServer = new events.EventEmitter();
  dummyServer.write = function(requestBuf) {
    request = utils.parseMessage(requestBuf);
    assert.equal("hello", request.key);
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
