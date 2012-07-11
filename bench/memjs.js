var MemJS = require('memjs').Client;

var client = MemJS.create();

for (var i = 0; i < 1; i += 1) {
  (function() {
    var j = 2500 * 6;
    var prev = Date.now();
    var listener = function() {
      if (j > 0) {
        j -= 1;
        client.get("hello", listener);
      } else {
        console.log(Date.now() - prev);
      }
    };
    listener();
  })();
}

