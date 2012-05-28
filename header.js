
var parseHeader = function(headerBuf) {
  return {
    magic:           headerBuf.readUInt8(0),
    opcode:          headerBuf.readUInt8(1),
    keyLength:       headerBuf.readUInt16BE(2),
    extrasLength:    headerBuf.readUInt8(4),
    totalBodyLength: headerBuf.readUInt32BE(8),
    opaque:          headerBuf.readUInt32BE(12),
    cas:             headerBuf.readUInt32BE(16)
  };
}

var headerToBuf = function(header) {
  headerBuf = new Buffer(24);
  headerBuf.writeUInt8(header.magic, 0);
  headerBuf.writeUInt8(header.opcode, 1);
  headerBuf.writeUInt16BE(header.keyLength, 2);
  headerBuf.writeUInt8(header.extrasLength, 4);
  headerBuf.writeUInt32BE(header.totalBodyLength, 8);
  headerBuf.writeUInt32BE(header.opaque, 12);
  headerBuf.writeUInt32BE(header.case, 16);
  return headerBuf;
}

exports.parseHeader = parseHeader;
exports.headerToBuf = headerToBuf;