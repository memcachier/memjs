var MemJS = require('../client');

exports.testSet = function(beforeExit, assert) {
  var n = 0;
  var client = new MemJS.Client([new MemJS.Server('localhost', 11211)]);
  client.set('hello', 'world', function(_d) {
    client.get('hello', function(d) {
      assert.equal('world', d ? d.toString() : d);
      client.close();
      n += 1;
    });
  });
  beforeExit(function() {
    assert.equal(1, n,  'Ensure set and get are called')
  });
}

exports.testStats = function(beforeExit, assert) {
  var n = 0;
  var client = new MemJS.Client([new MemJS.Server('localhost', 11211)]);
  client.stats(function(d) {
    assert.isDefined(d['curr_items']);
    client.close();
    n += 1;
  });
  beforeExit(function() {
    assert.equal(1, n,  'Ensure stats is called')
  });
}
