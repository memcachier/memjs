var MemJS = require('../client');
var JSTest = require('../lib/test');

JSTest.AddTestSuite({
  testSet: function() {
    var client = new MemJS.Client([new MemJS.Server('localhost', 11211)]);
    client.set('hello', 'world', function(_d) {
      client.get('hello', function(d) {
        JSTest.assertEqual('world', d ? d.toString() : d);
        client.close();
      });
    });
  },
  testStats: function() {
    var client = new MemJS.Client([new MemJS.Server('localhost', 11211)]);
    client.stats(function(d) {
      JSTest.assert(d['curr_items']);
      client.close();
    });
  }
});

JSTest.RunTests();