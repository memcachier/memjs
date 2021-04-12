const test = require('tap').test;
const header = require('../memjs/header');

test('ParseHeaderResponse', function(t) {
  const headerBuf = Buffer.from([0x81, 1, 7, 0, 4, 3, 0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0, 0, 0]);
  const responseHeader = header.fromBuffer(headerBuf);
  t.equal(0x81, responseHeader.magic);
  t.equal(1, responseHeader.opcode);
  t.equal(0x0700, responseHeader.keyLength);
  t.equal(4, responseHeader.extrasLength);
  t.equal(3, responseHeader.dataType);
  t.equal(1, responseHeader.status);
  t.equal(9, responseHeader.totalBodyLength);
  t.equal(0, responseHeader.opaque);
  t.equal(Buffer.from([0x0a, 0, 0, 0, 0, 0, 0, 0]).toString(), responseHeader.cas.toString());
  t.end();
});

test('DumpHeader', function(t) {
  const responseHeader = {
    magic: 0x81,
    opcode: 1,
    keyLength: 0x700,
    extrasLength: 4,
    dataType: 0,
    status: 1,
    totalBodyLength: 9,
    opaque: 0,
    cas: Buffer.from([0x0a, 0, 0, 0, 0, 0, 0, 0])
  };
  const expected = Buffer.from([0x81, 1, 7, 0, 4, 0, 0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0, 0, 0]);
  t.equal(header.toBuffer(responseHeader).toString(), expected.toString());
  t.end();
});

test('DumpHeaderNoCas', function(t) {
  const responseHeader = {
    magic: 0x81,
    opcode: 0,
    keyLength: 0x0,
    extrasLength: 0,
    dataType: 0,
    status: 0,
    totalBodyLength: 0,
    opaque: 0
  };
  const expected = Buffer.from([0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  t.equal(header.toBuffer(responseHeader).toString(), expected.toString());
  t.end();
});
