utils = require('../lib/memjs/utils')

exports.testMergePresereParameter = function(beforeExit, assert) {
  var result = utils.merge({}, { retries: 2 });
  assert.equal(2, result.retries);
}

exports.testMergePresereParameterWhenZero = function(beforeExit, assert) {
  var result = utils.merge({ retries: 0 }, { retries: 2 });
  assert.equal(0, result.retries);
}

exports.testMergeDontPresereParameterWhenUndefinedOrNull =
  function(beforeExit, assert) {
    var result = utils.merge({ retries: undefined }, { retries: 2 });
    assert.equal(2, result.retries);

    var result2 = utils.merge({ retries: null }, { retries: 2 });
    assert.equal(2, result2.retries);
  }

