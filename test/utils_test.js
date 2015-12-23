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

exports.testMakeAmountInitialAndExpiration = function(beforeExit, assert) {
    var extras, buf, fixture;
    extras = utils.makeAmountInitialAndExpiration(1, 1, 1);
    fixture = new Buffer('0000000000000001000000000000000100000001', 'hex');
    assert.equal(20, extras.length);
    assert.equal(fixture.toString('hex'), extras.toString('hex'));
    buf = new Buffer(extras);
    assert.equal(20, buf.length);
    assert.equal(fixture.toString('hex'), buf.toString('hex'));

    extras = utils.makeAmountInitialAndExpiration(255, 1, 1);
    fixture = new Buffer('00000000000000ff000000000000000100000001', 'hex');
    assert.equal(20, extras.length);
    assert.equal(fixture.toString('hex'), extras.toString('hex'));
    buf = new Buffer(extras);
    assert.equal(20, buf.length);
    assert.equal(fixture.toString('hex'), buf.toString('hex'));
}

exports.testMakeRequestBufferExtrasLength = function(beforeExit, assert) {
    extras = utils.makeAmountInitialAndExpiration(255, 1, 1);
    var buf = utils.makeRequestBuffer(0, 'test', extras, 1, 0);
    assert.equal(20, buf[4]);
}
