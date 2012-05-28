var MemJS = require("../mem");
var JSTest = require("../lib/test");

JSTest.AddTestSuite({
  testSet: function() {
    var client = new MemJS.Client([new MemJS.Server("localhost:11211")]);
    client.set("hello", "world", function(_d) {
      client.get("hello", function(d) {
        JSTest.assertEqual("world", d ? d.toString() : d);
        client.servers[0].close();
      });
    });
  },
});

JSTest.RunTests();