// # MemJS utility functions

import * as header from "./header";
import { OP } from "./constants";

export type MaybeBuffer = string | Buffer;

export const bufferify = function (val: MaybeBuffer) {
  return Buffer.isBuffer(val) ? val : Buffer.from(val as any);
};

export interface EncodableRequest {
  header: Omit<
    header.Header,
    "magic" | "keyLength" | "extrasLength" | "totalBodyLength"
  >;
  key: MaybeBuffer;
  extras: MaybeBuffer;
  value: MaybeBuffer;
}

export function encodeRequestIntoBuffer(
  buffer: Buffer,
  offset: number,
  request: EncodableRequest
) {
  const key = bufferify(request.key);
  const extras = bufferify(request.extras);
  const value = bufferify(request.value);

  const bufTargetWriteOffset = offset || 0;
  let totalBytesWritten = 0;
  function copyIntoBuffer(toWriteBuffer: Buffer) {
    const bytesWritten = toWriteBuffer.copy(
      buffer,
      bufTargetWriteOffset + totalBytesWritten
    );
    totalBytesWritten += bytesWritten;
  }

  const requestHeader: header.Header = {
    ...request.header,
    magic: 0x80,
    keyLength: key.length,
    extrasLength: extras.length,
    totalBodyLength: key.length + value.length + extras.length,
  };

  const headerBuffer = header.toBuffer(requestHeader);

  copyIntoBuffer(headerBuffer);
  copyIntoBuffer(extras);
  copyIntoBuffer(key);
  copyIntoBuffer(value);

  return totalBytesWritten;
}

export function encodeRequest(request: EncodableRequest): Buffer {
  const key = bufferify(request.key);
  const extras = bufferify(request.extras);
  const value = bufferify(request.value);
  const bufSize = 24 + key.length + extras.length + value.length;
  const buffer = Buffer.alloc(bufSize);
  encodeRequestIntoBuffer(buffer, 0, {
    ...request,
    key,
    extras,
    value,
  });
  return buffer;
}

export const copyIntoRequestBuffer = function (
  opcode: OP,
  key: MaybeBuffer,
  extras: MaybeBuffer,
  value: MaybeBuffer,
  opaque: number,
  buf: Buffer,
  _bufTargetWriteOffset?: number
) {
  return encodeRequestIntoBuffer(buf, _bufTargetWriteOffset || 0, {
    header: {
      opcode,
      opaque,
    },
    key,
    extras,
    value,
  });
};

export const makeRequestBuffer = function (
  opcode: OP,
  key: MaybeBuffer,
  extras: MaybeBuffer,
  value: MaybeBuffer,
  opaque?: number
) {
  return encodeRequest({
    extras,
    key,
    value,
    header: {
      opcode,
      opaque: opaque || 0,
    },
  });
};

export const makeAmountInitialAndExpiration = function (
  amount: number,
  amountIfEmpty: number,
  expiration: number
) {
  const buf = Buffer.alloc(20);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(amount, 4);
  buf.writeUInt32BE(0, 8);
  buf.writeUInt32BE(amountIfEmpty, 12);
  buf.writeUInt32BE(expiration, 16);
  return buf;
};

export const makeExpiration = function (expiration: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(expiration, 0);
  return buf;
};

export const hashCode = function (str: string) {
  let ret, i, len;
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

const ERROR_TOO_MANY_OPEN_CONNECTIONS = "ERROR Too many open connections\r\n";

export const parseMessage = function (dataBuf: Buffer): Message | false {
  if (dataBuf.length < 24) {
    return false;
  }

  if (dataBuf.length === ERROR_TOO_MANY_OPEN_CONNECTIONS.length) {
    if (dataBuf.toString() === ERROR_TOO_MANY_OPEN_CONNECTIONS) {
      throw new Error("ERROR Too many open connections");
    }
  }

  const responseHeader = header.fromBuffer(dataBuf);

  if (
    dataBuf.length < responseHeader.totalBodyLength + 24 ||
    responseHeader.totalBodyLength <
      responseHeader.keyLength + responseHeader.extrasLength
  ) {
    return false;
  }

  let pointer = 24;
  const extras = dataBuf.slice(pointer, pointer + responseHeader.extrasLength);
  pointer += responseHeader.extrasLength;
  const key = dataBuf.slice(pointer, pointer + responseHeader.keyLength);
  pointer += responseHeader.keyLength;
  const val = dataBuf.slice(pointer, 24 + responseHeader.totalBodyLength);

  return { header: responseHeader, key: key, extras: extras, val: val };
};

export const parseMessages = function (dataBuf: Buffer): Message[] {
  const messages = [];

  let message: Message;

  do {
    message = exports.parseMessage(dataBuf);
    if (message) {
      messages.push(message);
      const messageLength = message.header.totalBodyLength + 24;
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
  const times = process.hrtime();
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

    let i: number;
    let buf: Buffer;

    if (typeof length !== "number") {
      length = 0;
      for (i = 0; i < list.length; i++) {
        buf = list[i];
        length += buf.length;
      }
    }

    const buffer = Buffer.alloc(length);
    let pos = 0;
    for (let i = 0; i < list.length; i++) {
      buf = list[i];
      buf.copy(buffer, pos);
      pos += buf.length;
    }
    return buffer;
  };
}
