var header = require('./header');

exports.makeRequestBuffer = function(opcode, key, extras, value) {
  var buf = new Buffer(24 + key.length + extras.length + value.length);
  buf.fill();
  var requestHeader = {
    magic: 0x80,
    opcode: opcode,
    keyLength: key.length,
    extrasLength: extras.length,
    totalBodyLength: key.length + value.length + extras.length
  };
  header.toBuffer(requestHeader).copy(buf);
  buf.write(extras, 24)
  buf.write(key, 24 + extras.length);
  buf.write(value, 24 + extras.length + key.length);
  return buf;
}

exports.hashCode = function(str) {
  for(var ret = 0, i = 0, len = str.length; i < len; i++) {
    ret = (31 * ret + str.charCodeAt(i)) << 0;
  }
  return ret;
};

exports.parseResponse = function(dataBuf) {
  if (dataBuf.length < 24) {
    return false;
  }
  var responseHeader = header.fromBuffer(dataBuf);
  if (dataBuf.length < responseHeader.totalBodyLength + 24 || responseHeader.totalBodyLength < responseHeader.keyLength + responseHeader.extrasLength) {
    return false;
  }
  
  var pointer = 24;
  var extras = dataBuf.slice(pointer, (pointer += responseHeader.extrasLength));
  var key = dataBuf.slice(pointer, (pointer += responseHeader.keyLength));
  var value = dataBuf.slice(pointer, 24 + responseHeader.totalBodyLength);
  
  return {header: responseHeader, key: key, extras: extras, value: value};
}
