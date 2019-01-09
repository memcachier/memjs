// # MemJS Memcache node buffer operations

// Before node v5.10.0 alloc() and from() did not exist
// this is a way to make sure that memjs works for previous versions
// in a safe manner
if (!Buffer.alloc) {
  exports.alloc = function(size) {
    var buf = new Buffer(size);
    buf.fill();
    return buf;
  };

  exports.from = function(value, encodingOrOffset, length) {
    return new Buffer(value, encodingOrOffset, length);
  };
} else {
  exports.alloc = Buffer.alloc;
  exports.from = Buffer.from; 
}


// Node Buffer.concat was not added until node v0.7.11
// this is a way to add backwards compatability
if(!Buffer.concat) {
  exports.concat = function(list, length) {
    if (!Array.isArray(list)) {
      throw new Error('Usage: concatNodeBuffer(list, [length])');
    }

    if (list.length === 0) {
      return new Buffer(0);
    }
    if (list.length === 1) {
      return list[0];
    }

    var i, buf;

    if (typeof length !== 'number') {
      length = 0;
      for (i = 0; i < list.length; i++) {
        buf = list[i];
        length += buf.length;
      }
    }

    var buffer = new Buffer(length);
    buffer.fill();
    var pos = 0;
    for (i = 0; i < list.length; i++) {
      buf = list[i];
      buf.copy(buffer, pos);
      pos += buf.length;
    }
    return buffer;
  };
} else {
  exports.concat = Buffer.concat;
}

exports.bufferify = function(val) {
  return Buffer.isBuffer(val) ? val : exports.from(val);
};
