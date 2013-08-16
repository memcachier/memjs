utils = require('../lib/memjs/utils')

exports.testMergePresereParameter = function(beforeExit, assert) {
  result = utils.merge({}, { retries: 2 });
  assert.equal(2, result.retries);
}

exports.testMergePresereParameterWhenZero = function(beforeExit, assert) {
  result = utils.merge({ retries: 0 }, { retries: 2 });
  assert.equal(0, result.retries);
}

