var valueTypes = require('./value-types');

function serializeValue(value) {
  switch (valueTypes.getValueType(value)) {
  case valueTypes.TYPE_NUMBER:
    return value.toString();
  case valueTypes.TYPE_JSON:
    return JSON.stringify(value);
  default:
    return value;
  }
}

function deSerializeValue(value, type) {
  switch (type) {
  case valueTypes.TYPE_BINARY:
    return value.toString();
  case valueTypes.TYPE_NUMBER:
    return parseFloat(value);
  case valueTypes.TYPE_JSON:
    return JSON.parse(value);
  case 0:
    try {
      return JSON.parse(value);
    } catch (e) {
      // fall through
    }
  default:
    return value;
  }
}

function storeInfoByValueInExtras(value, extras) {
  var valueType = valueTypes.getValueType(value);
  extras.writeUInt32BE(valueType, 0);

  return extras;
}

function getTypeInfoFromExtra(extras) {
  return extras.length && extras.readUInt32BE(0);
}

module.exports = {
  serializeValue: serializeValue,
  deSerializeValue: deSerializeValue,
  storeInfoByValueInExtras: storeInfoByValueInExtras,
  getTypeInfoFromExtra: getTypeInfoFromExtra
};
