var TYPE_BINARY = 1;
var TYPE_NUMBER = 2;
var TYPE_JSON = 3;

function getValueType(value) {
  if (typeof value == 'number') {
    return TYPE_NUMBER;
  }

  if (typeof value == 'string' || Buffer.isBuffer(value)) {
    return TYPE_BINARY;
  }

  return TYPE_JSON;
}

module.exports = {
  getValueType: getValueType,
  TYPE_JSON: TYPE_JSON,
  TYPE_BINARY: TYPE_BINARY,
  TYPE_NUMBER: TYPE_NUMBER
};
