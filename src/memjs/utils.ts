// # MemJS utility functions

import * as header from "./header";
import { OP } from "./constants";

export type MaybeBuffer = string | Buffer;

export const bufferify = function (val: MaybeBuffer) {
  return Buffer.isBuffer(val) ? val : Buffer.from(val as any);
};

export const copyIntoRequestBuffer = function (
  opcode: OP,
  key: MaybeBuffer,
  extras: MaybeBuffer,
  value: MaybeBuffer,
  opaque: number,
  buf: Buffer,
  _bufTargetWriteOffset?: number
) {
  key = bufferify(key);
  extras = bufferify(extras);
  value = bufferify(value);

  var bufTargetWriteOffset = _bufTargetWriteOffset || 0;
  var totalBytesWritten = 0;
  function copyIntoBuffer(toWriteBuffer: Buffer) {
    var bytesWritten = toWriteBuffer.copy(
      buf,
      bufTargetWriteOffset + totalBytesWritten
    );
    totalBytesWritten += bytesWritten;
  }

  var requestHeader: header.Header = {
    magic: 0x80,
    opcode: opcode,
    keyLength: key.length,
    extrasLength: extras.length,
    totalBodyLength: key.length + value.length + extras.length,
    opaque: opaque,
  };
  var headerBuffer = header.toBuffer(requestHeader);

  copyIntoBuffer(headerBuffer);
  copyIntoBuffer(extras);
  copyIntoBuffer(key);
  copyIntoBuffer(value);

  return totalBytesWritten;
};

export const makeRequestBuffer = function (
  opcode: OP,
  key: MaybeBuffer,
  extras: MaybeBuffer,
  value: MaybeBuffer,
  opaque?: number
) {
  key = bufferify(key);
  extras = bufferify(extras);
  value = bufferify(value);

  var bufSize = 24 + key.length + extras.length + value.length;

  var buf = Buffer.alloc(bufSize);
  buf.fill(0);
  copyIntoRequestBuffer(opcode, key, extras, value, opaque || 0, buf);
  return buf;
};

export const makeAmountInitialAndExpiration = function (
  amount: number,
  amountIfEmpty: number,
  expiration: number
) {
  var buf = Buffer.alloc(20);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(amount, 4);
  buf.writeUInt32BE(0, 8);
  buf.writeUInt32BE(amountIfEmpty, 12);
  buf.writeUInt32BE(expiration, 16);
  return buf;
};

export const makeExpiration = function (expiration: number) {
  var buf = Buffer.alloc(4);
  buf.writeUInt32BE(expiration, 0);
  return buf;
};

export const hashCode = function (str: string) {
  var ret, i, len;
  for (ret = 0, i = 0, len = str.length; i < len; i++) {
    ret = (31 * ret + str.charCodeAt(i)) << 0;
  }
  return Math.abs(ret);
};

export interface Message {
  header: header.Header;
  key: Buffer;
  val: Buffer;
  extras: Buffer;
}

export const parseMessage = function (dataBuf: Buffer): Message | false {
  if (dataBuf.length < 24) {
    return false;
  }
  var responseHeader = header.fromBuffer(dataBuf);

  if (
    dataBuf.length < responseHeader.totalBodyLength + 24 ||
    responseHeader.totalBodyLength <
      responseHeader.keyLength + responseHeader.extrasLength
  ) {
    return false;
  }

  var pointer = 24;
  var extras = dataBuf.slice(pointer, pointer + responseHeader.extrasLength);
  pointer += responseHeader.extrasLength;
  var key = dataBuf.slice(pointer, pointer + responseHeader.keyLength);
  pointer += responseHeader.keyLength;
  var val = dataBuf.slice(pointer, 24 + responseHeader.totalBodyLength);

  return { header: responseHeader, key: key, extras: extras, val: val };
};

export const parseMessages = function (dataBuf: Buffer): Message[] {
  var messages = [];

  do {
    var message = exports.parseMessage(dataBuf);
    if (message) {
      messages.push(message);
      var messageLength = message.header.totalBodyLength + 24;
      dataBuf = dataBuf.slice(messageLength);
    }
  } while (message);

  return messages;
};

export const merge = function <T>(original: any, deflt: T): T {
  for (let attrT of Object.keys(deflt)) {
    const attr: keyof T = attrT as any;
    const originalValue = original[attr];

    if (originalValue === undefined || originalValue === null) {
      original[attr] = deflt[attr] as any;
    }
  }
  return original;
};

// timestamp provides a monotonic timestamp with millisecond accuracy, useful
// for timers.
export const timestamp = function () {
  var times = process.hrtime();
  return times[0] * 1000 + Math.round(times[1] / 1000000);
};

if (!Buffer.concat) {
  Buffer.concat = function (list, length) {
    if (!Array.isArray(list)) {
      throw new Error("Usage: Buffer.concat(list, [length])");
    }

    if (list.length === 0) {
      return Buffer.alloc(0);
    }
    if (list.length === 1) {
      return list[0];
    }

    var i, buf;

    if (typeof length !== "number") {
      length = 0;
      for (i = 0; i < list.length; i++) {
        buf = list[i];
        length += buf.length;
      }
    }

    var buffer = Buffer.alloc(length);
    var pos = 0;
    for (i = 0; i < list.length; i++) {
      buf = list[i];
      buf.copy(buffer, pos);
      pos += buf.length;
    }
    return buffer;
  };
}
