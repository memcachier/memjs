var header = require("../header");
var JSTest = require("../lib/test");

JSTest.AddTestSuite({
  testParseHeaderResponse: function() {
    var headerBuf = new Buffer([0x81, 1, 7, 0, 4, 0, 0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0, 0, 0]);
    var responseHeader = header.fromBuffer(headerBuf);
    JSTest.assertEqual(0x81, responseHeader.magic);
    JSTest.assertEqual(1, responseHeader.opcode);
    JSTest.assertEqual(0x0700, responseHeader.keyLength);
    JSTest.assertEqual(4, responseHeader.extrasLength);
    JSTest.assertEqual(0, responseHeader.dataType);
    JSTest.assertEqual(1, responseHeader.status);
    JSTest.assertEqual(9, responseHeader.totalBodyLength);
    JSTest.assertEqual(0, responseHeader.opaque);
    JSTest.assertEqual(new Buffer([0x0a, 0, 0, 0, 0, 0, 0, 0]).toString(), responseHeader.cas);
  },
  testDumpHeader: function() {
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
    JSTest.assertEqual(header.toBuffer(responseHeader).toString(), expected.toString());
  }
});

JSTest.RunTests();