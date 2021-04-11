const test = require('tap').test;
const utils = require('../lib/memjs/utils');

test('MergePresereParameter', function(t) {
  const result = utils.merge({}, { retries: 2 });
  t.equal(2, result.retries);
  t.end();
});

test('MergePresereParameterWhenZero', function(t) {
  const result = utils.merge({ retries: 0 }, { retries: 2 });
  t.equal(0, result.retries);
  t.end();
});

test('MergeDontPresereParameterWhenUndefinedOrNull', function(t) {
  const result = utils.merge({ retries: undefined }, { retries: 2 });
  t.equal(2, result.retries);

  const result2 = utils.merge({ retries: null }, { retries: 2 });
  t.equal(2, result2.retries);
  t.end();
});

test('MakeAmountInitialAndExpiration', function(t) {
  let extras, buf, fixture;
  extras = utils.makeAmountInitialAndExpiration(1, 1, 1);
  fixture = Buffer.from('0000000000000001000000000000000100000001', 'hex');
  t.equal(20, extras.length);
  t.equal(fixture.toString('hex'), extras.toString('hex'));
  buf = Buffer.from(extras);
  t.equal(20, buf.length);
  t.equal(fixture.toString('hex'), buf.toString('hex'));

  extras = utils.makeAmountInitialAndExpiration(255, 1, 1);
  fixture = Buffer.from('00000000000000ff000000000000000100000001', 'hex');
  t.equal(20, extras.length);
  t.equal(fixture.toString('hex'), extras.toString('hex'));
  buf = Buffer.from(extras);
  t.equal(20, buf.length);
  t.equal(fixture.toString('hex'), buf.toString('hex'));
  t.end();
});

exports.testMakeRequestBufferExtrasLength = function(t) {
  const extras = utils.makeAmountInitialAndExpiration(255, 1, 1);
  const buf = utils.makeRequestBuffer(0, 'test', extras, 1, 0);
  t.equal(20, buf[4]);
  t.end();
};
