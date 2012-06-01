var MemJS = require('../client');

exports.testSet = function(beforeExit, assert) {
  var n = 0;
  var client = new MemJS.Client([new MemJS.Server('localhost', 11211)]);
  client.set('hello', 'world', function(_d) {
    client.get('hello', function(d) {
      n += 1;
      assert.equal('world', d ? d.toString() : d);
      client.close();
    });
  });
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set and get are called')
  });
}

exports.testStats = function(beforeExit, assert) {
  var n = 0;
  var client = new MemJS.Client([new MemJS.Server('localhost', 11211)]);
  client.stats(function(server, result) {
    n += 1;
    assert.equal('localhost:11211', server);
    assert.isDefined(result['bytes']);
    client.close();
  });
  beforeExit(function() {
    assert.equal(1, n,  'Ensure stats is called')
  });
}
