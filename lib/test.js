var sys = require('util');

var suites = [];
var cases = 0;

var fail = function(message) {
  if (!message) {
    message = 'Failed.';
  }
  throw message;
}

exports.fail = fail;

var assert = function(condition, message) {
  cases += 1;
  if (!message) {
    message = 'Expected condition [true], but was [' + condition + '].'
  }
  if (!condition) {
    fail(message);
  }
}

exports.assert = assert;

exports.assertEqual = function(expected, actual, message) {
  if (!message) {
    message = 'Excepcted [' + expected + '], but got [' + actual + ']';
  }
  if (expected.equals) {
    assert(expected.equals(actual), message);
  } else {
    assert(expected == actual, message);
  }
},

exports.assertException = function(func, message) {
  if (!message) {
    message = 'Exception expected, but was not caught.';
  }
  var caught;
  try {
    func();
  } catch(er) {
    caught = true;
  } finally {
    if (!caught) {
      fail(message);
    }
  }
},

exports.AddTestSuite = function(TestSuite) {
  suites.push(TestSuite);
},

exports.RunTests = function() {
  var successes = 0;
  var errors = 0;
  for (var i in suites) {
    var TestSuite = suites[i];
    for (var k in TestSuite) {
      try {
        TestSuite[k]();
        successes += 1;
      } catch(er) {
        sys.puts('Error in \'' + k + '\':');
        sys.puts('\t' + er);
        errors += 1;
      }
    }
  }

  sys.puts('Finished: ' + successes + ' sucess(es), ' + errors + ' error(s), ' + cases + ' case(s).');
}
