var header = require('header');

exports.testParseHeaderResponse = function(be, assert) {
  var headerBuf = new Buffer([0x81, 1, 7, 0, 4, 0, 0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0, 0, 0]);
  var responseHeader = header.fromBuffer(headerBuf);
  assert.equal(0x81, responseHeader.magic);
  assert.equal(1, responseHeader.opcode);
  assert.equal(0x0700, responseHeader.keyLength);
  assert.equal(4, responseHeader.extrasLength);
  assert.equal(0, responseHeader.dataType);
  assert.equal(1, responseHeader.status);
  assert.equal(9, responseHeader.totalBodyLength);
  assert.equal(0, responseHeader.opaque);
  assert.equal(new Buffer([0x0a, 0, 0, 0, 0, 0, 0, 0]).toString(), responseHeader.cas);
}

var testDumpHeader= function(be, assert) {
  responseHeader = {
    magic: 0x81,
    opcode: 1,
    keyLength: 0x700,
    extrasLength: 4,
    dataType: 0,
    status: 1,
    totalBodyLength: 9,
    opaque: 0,
    cas: new Buffer([0x0a, 0, 0, 0, 0, 0, 0, 0])
  }
  expected = new Buffer([0x81, 1, 7, 0, 4, 0, 0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(header.toBuffer(responseHeader).toString(), expected.toString());
}

