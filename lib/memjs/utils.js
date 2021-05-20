"use strict";
// # MemJS utility functions
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.timestamp = exports.merge = exports.parseMessages = exports.parseMessage = exports.hashCode = exports.makeExpiration = exports.makeAmountInitialAndExpiration = exports.makeRequestBuffer = exports.copyIntoRequestBuffer = exports.encodeRequest = exports.encodeRequestIntoBuffer = exports.bufferify = void 0;
const header = __importStar(require("./header"));
const bufferify = function (val) {
    return Buffer.isBuffer(val) ? val : Buffer.from(val);
};
exports.bufferify = bufferify;
function encodeRequestIntoBuffer(buffer, offset, request) {
    const key = exports.bufferify(request.key);
    const extras = exports.bufferify(request.extras);
    const value = exports.bufferify(request.value);
    const bufTargetWriteOffset = offset || 0;
    let totalBytesWritten = 0;
    function copyIntoBuffer(toWriteBuffer) {
        const bytesWritten = toWriteBuffer.copy(buffer, bufTargetWriteOffset + totalBytesWritten);
        totalBytesWritten += bytesWritten;
    }
    const requestHeader = {
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
exports.encodeRequestIntoBuffer = encodeRequestIntoBuffer;
function encodeRequest(request) {
    const key = exports.bufferify(request.key);
    const extras = exports.bufferify(request.extras);
    const value = exports.bufferify(request.value);
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
exports.encodeRequest = encodeRequest;
const copyIntoRequestBuffer = function (opcode, key, extras, value, opaque, buf, _bufTargetWriteOffset) {
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
exports.copyIntoRequestBuffer = copyIntoRequestBuffer;
const makeRequestBuffer = function (opcode, key, extras, value, opaque) {
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
exports.makeRequestBuffer = makeRequestBuffer;
const makeAmountInitialAndExpiration = function (amount, amountIfEmpty, expiration) {
    const buf = Buffer.alloc(20);
    buf.writeUInt32BE(0, 0);
    buf.writeUInt32BE(amount, 4);
    buf.writeUInt32BE(0, 8);
    buf.writeUInt32BE(amountIfEmpty, 12);
    buf.writeUInt32BE(expiration, 16);
    return buf;
};
exports.makeAmountInitialAndExpiration = makeAmountInitialAndExpiration;
const makeExpiration = function (expiration) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(expiration, 0);
    return buf;
};
exports.makeExpiration = makeExpiration;
const hashCode = function (str) {
    let ret, i, len;
    for (ret = 0, i = 0, len = str.length; i < len; i++) {
        ret = (31 * ret + str.charCodeAt(i)) << 0;
    }
    return Math.abs(ret);
};
exports.hashCode = hashCode;
const parseMessage = function (dataBuf) {
    if (dataBuf.length < 24) {
        return false;
    }
    const responseHeader = header.fromBuffer(dataBuf);
    if (dataBuf.length < responseHeader.totalBodyLength + 24 ||
        responseHeader.totalBodyLength <
            responseHeader.keyLength + responseHeader.extrasLength) {
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
exports.parseMessage = parseMessage;
const parseMessages = function (dataBuf) {
    const messages = [];
    let message;
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
exports.parseMessages = parseMessages;
const merge = function (original, deflt) {
    for (let attrT of Object.keys(deflt)) {
        const attr = attrT;
        const originalValue = original[attr];
        if (originalValue === undefined || originalValue === null) {
            original[attr] = deflt[attr];
        }
    }
    return original;
};
exports.merge = merge;
// timestamp provides a monotonic timestamp with millisecond accuracy, useful
// for timers.
const timestamp = function () {
    const times = process.hrtime();
    return times[0] * 1000 + Math.round(times[1] / 1000000);
};
exports.timestamp = timestamp;
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
        let i;
        let buf;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvbWVtanMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLDRCQUE0Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUU1QixpREFBbUM7QUFLNUIsTUFBTSxTQUFTLEdBQUcsVUFBVSxHQUFnQjtJQUNqRCxPQUFPLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFVLENBQUMsQ0FBQztBQUM5RCxDQUFDLENBQUM7QUFGVyxRQUFBLFNBQVMsYUFFcEI7QUFZRixTQUFnQix1QkFBdUIsQ0FDckMsTUFBYyxFQUNkLE1BQWMsRUFDZCxPQUF5QjtJQUV6QixNQUFNLEdBQUcsR0FBRyxpQkFBUyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNuQyxNQUFNLE1BQU0sR0FBRyxpQkFBUyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN6QyxNQUFNLEtBQUssR0FBRyxpQkFBUyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUV2QyxNQUFNLG9CQUFvQixHQUFHLE1BQU0sSUFBSSxDQUFDLENBQUM7SUFDekMsSUFBSSxpQkFBaUIsR0FBRyxDQUFDLENBQUM7SUFDMUIsU0FBUyxjQUFjLENBQUMsYUFBcUI7UUFDM0MsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FDckMsTUFBTSxFQUNOLG9CQUFvQixHQUFHLGlCQUFpQixDQUN6QyxDQUFDO1FBQ0YsaUJBQWlCLElBQUksWUFBWSxDQUFDO0lBQ3BDLENBQUM7SUFFRCxNQUFNLGFBQWEsR0FBa0I7UUFDbkMsR0FBRyxPQUFPLENBQUMsTUFBTTtRQUNqQixLQUFLLEVBQUUsSUFBSTtRQUNYLFNBQVMsRUFBRSxHQUFHLENBQUMsTUFBTTtRQUNyQixZQUFZLEVBQUUsTUFBTSxD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LENBQUM7UUFFaEIsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLEVBQUU7WUFDOUIsTUFBTSxHQUFHLENBQUMsQ0FBQztZQUNYLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtnQkFDaEMsR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDZCxNQUFNLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQzthQUN0QjtTQUNGO1FBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNwQyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUM7UUFDWixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUNwQyxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2QsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDdEIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUM7U0FDbkI7UUFDRCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDLENBQUM7Q0FDSCIsInNvdXJjZXNDb250ZW50IjpbIi8vICMgTWVtSlMgdXRpbGl0eSBmdW5jdGlvbnNcblxuaW1wb3J0ICogYXMgaGVhZGVyIGZyb20gXCIuL2hlYWRlclwiO1xuaW1wb3J0IHsgT1AgfSBmcm9tIFwiLi9jb25zdGFudHNcIjtcblxuZXhwb3J0IHR5cGUgTWF5YmVCdWZmZXIgPSBzdHJpbmcgfCBCdWZmZXI7XG5cbmV4cG9ydCBjb25zdCBidWZmZXJpZnkgPSBmdW5jdGlvbiAodmFsOiBNYXliZUJ1ZmZlcikge1xuICByZXR1cm4gQnVmZmVyLmlzQnVmZmVyKHZhbCkgPyB2YWwgOiBCdWZmZXIuZnJvbSh2YWwgYXMgYW55KTtcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW5jb2RhYmxlUmVxdWVzdCB7XG4gIGhlYWRlcjogT21pdDxcbiAgICBoZWFkZXIuSGVhZGVyLFxuICAgIFwibWFnaWNcIiB8IFwia2V5TGVuZ3RoXCIgfCBcImV4dHJhc0xlbmd0aFwiIHwgXCJ0b3RhbEJvZHlMZW5ndGhcIlxuICA+O1xuICBrZXk6IE1heWJlQnVmZmVyO1xuICBleHRyYXM6IE1heWJlQnVmZmVyO1xuICB2YWx1ZTogTWF5YmVCdWZmZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbmNvZGVSZXF1ZXN0SW50b0J1ZmZlcihcbiAgYnVmZmVyOiBCdWZmZXIsXG4gIG9mZnNldDogbnVtYmVyLFxuICByZXF1ZXN0OiBFbmNvZGFibGVSZXF1ZXN0XG4pIHtcbiAgY29uc3Qga2V5ID0gYnVmZmVyaWZ5KHJlcXVlc3Qua2V5KTtcbiAgY29uc3QgZXh0cmFzID0gYnVmZmVyaWZ5KHJlcXVlc3QuZXh0cmFzKTtcbiAgY29uc3QgdmFsdWUgPSBidWZmZXJpZnkocmVxdWVzdC52YWx1ZSk7XG5cbiAgY29uc3QgYnVmVGFyZ2V0V3JpdGVPZmZzZXQgPSBvZmZzZXQgfHwgMDtcbiAgbGV0IHRvdGFsQnl0ZXNXcml0dGVuID0gMDtcbiAgZnVuY3Rpb24gY29weUludG9CdWZmZXIodG9Xcml0ZUJ1ZmZlcjogQnVmZmVyKSB7XG4gICAgY29uc3QgYnl0ZXNXcml0dGVuID0gdG9Xcml0ZUJ1ZmZlci5jb3B5KFxuICAgICAgYnVmZmVyLFxuICAgICAgYnVmVGFyZ2V0V3JpdGVPZmZzZXQgKyB0b3RhbEJ5dGVzV3JpdHRlblxuICAgICk7XG4gICAgdG90YWxCeXRlc1dyaXR0ZW4gKz0gYnl0ZXNXcml0dGVuO1xuICB9XG5cbiAgY29uc3QgcmVxdWVzdEhlYWRlcjogaGVhZGVyLkhlYWRlciA9IHtcbiAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICBtYWdpYzogMHg4MCxcbiAgICBrZXlMZW5ndGg6IGtleS5sZW5ndGgsXG4gICAgZXh0cmFzTGVuZ3RoOiBleHRyYXMubGVuZ3RoLFxuICAgIHRvdGFsQm9keUxlbmd0aDoga2V5Lmxlbmd0aCArIHZhbHVlLmxlbmd0aCArIGV4dHJhcy5sZW5ndGgsXG4gIH07XG5cbiAgY29uc3QgaGVhZGVyQnVmZmVyID0gaGVhZGVyLnRvQnVmZmVyKHJlcXVlc3RIZWFkZXIpO1xuXG4gIGNvcHlJbnRvQnVmZmVyKGhlYWRlckJ1ZmZlcik7XG4gIGNvcHlJbnRvQnVmZmVyKGV4dHJhcyk7XG4gIGNvcHlJbnRvQnVmZmVyKGtleSk7XG4gIGNvcHlJbnRvQnVmZmVyKHZhbHVlKTtcblxuICByZXR1cm4gdG90YWxCeXRlc1dyaXR0ZW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbmNvZGVSZXF1ZXN0KHJlcXVlc3Q6IEVuY29kYWJsZVJlcXVlc3QpOiBCdWZmZXIge1xuICBjb25zdCBrZXkgPSBidWZmZXJpZnkocmVxdWVzdC5rZXkpO1xuICBjb25zdCBleHRyYXMgPSBidWZmZXJpZnkocmVxdWVzdC5leHRyYXMpO1xuICBjb25zdCB2YWx1ZSA9IGJ1ZmZlcmlmeShyZXF1ZXN0LnZhbHVlKTtcbiAgY29uc3QgYnVmU2l6ZSA9IDI0ICsga2V5Lmxlbmd0aCArIGV4dHJhcy5sZW5ndGggKyB2YWx1ZS5sZW5ndGg7XG4gIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5hbGxvYyhidWZTaXplKTtcbiAgZW5jb2RlUmVxdWVzdEludG9CdWZmZXIoYnVmZmVyLCAwLCB7XG4gICAgLi4ucmVxdWVzdCxcbiAgICBrZXksXG4gICAgZXh0cmFzLFxuICAgIHZhbHVlLFxuICB9KTtcbiAgcmV0dXJuIGJ1ZmZlcjtcbn1cblxuZXhwb3J0IGNvbnN0IGNvcHlJbnRvUmVxdWVzdEJ1ZmZlciA9IGZ1bmN0aW9uIChcbiAgb3Bjb2RlOiBPUCxcbiAga2V5OiBNYXliZUJ1ZmZlcixcbiAgZXh0cmFzOiBNYXliZUJ1ZmZlcixcbiAgdmFsdWU6IE1heWJlQnVmZmVyLFxuICBvcGFxdWU6IG51bWJlcixcbiAgYnVmOiBCdWZmZXIsXG4gIF9idWZUYXJnZXRXcml0ZU9mZnNldD86IG51bWJlclxuKSB7XG4gIHJldHVybiBlbmNvZGVSZXF1ZXN0SW50b0J1ZmZlcihidWYsIF9idWZUYXJnZXRXcml0ZU9mZnNldCB8fCAwLCB7XG4gICAgaGVhZGVyOiB7XG4gICAgICBvcGNvZGUsXG4gICAgICBvcGFxdWUsXG4gICAgfSxcbiAgICBrZXksXG4gICAgZXh0cmFzLFxuICAgIHZhbHVlLFxuICB9KTtcbn07XG5cbmV4cG9ydCBjb25zdCBtYWtlUmVxdWVzdEJ1ZmZlciA9IGZ1bmN0aW9uIChcbiAgb3Bjb2RlOiBPUCxcbiAga2V5OiBNYXliZUJ1ZmZlcixcbiAgZXh0cmFzOiBNYXliZUJ1ZmZlcixcbiAgdmFsdWU6IE1heWJlQnVmZmVyLFxuICBvcGFxdWU/OiBudW1iZXJcbikge1xuICByZXR1cm4gZW5jb2RlUmVxdWVzdCh7XG4gICAgZXh0cmFzLFxuICAgIGtleSxcbiAgICB2YWx1ZSxcbiAgICBoZWFkZXI6IHtcbiAgICAgIG9wY29kZSxcbiAgICAgIG9wYXF1ZTogb3BhcXVlIHx8IDAsXG4gICAgfSxcbiAgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgbWFrZUFtb3VudEluaXRpYWxBbmRFeHBpcmF0aW9uID0gZnVuY3Rpb24gKFxuICBhbW91bnQ6IG51bWJlcixcbiAgYW1vdW50SWZFbXB0eTogbnVtYmVyLFxuICBleHBpcmF0aW9uOiBudW1iZXJcbikge1xuICBjb25zdCBidWYgPSBCdWZmZXIuYWxsb2MoMjApO1xuICBidWYud3JpdGVVSW50MzJCRSgwLCAwKTtcbiAgYnVmLndyaXRlVUludDMyQkUoYW1vdW50LCA0KTtcbiAgYnVmLndyaXRlVUludDMyQkUoMCwgOCk7XG4gIGJ1Zi53cml0ZVVJbnQzMkJFKGFtb3VudElmRW1wdHksIDEyKTtcbiAgYnVmLndyaXRlVUludDMyQkUoZXhwaXJhdGlvbiwgMTYpO1xuICByZXR1cm4gYnVmO1xufTtcblxuZXhwb3J0IGNvbnN0IG1ha2VFeHBpcmF0aW9uID0gZnVuY3Rpb24gKGV4cGlyYXRpb246IG51bWJlcikge1xuICBjb25zdCBidWYgPSBCdWZmZXIuYWxsb2MoNCk7XG4gIGJ1Zi53cml0ZVVJbnQzMkJFKGV4cGlyYXRpb24sIDApO1xuICByZXR1cm4gYnVmO1xufTtcblxuZXhwb3J0IGNvbnN0IGhhc2hDb2RlID0gZnVuY3Rpb24gKHN0cjogc3RyaW5nKSB7XG4gIGxldCByZXQsIGksIGxlbjtcbiAgZm9yIChyZXQgPSAwLCBpID0gMCwgbGVuID0gc3RyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgcmV0ID0gKDMxICogcmV0ICsgc3RyLmNoYXJDb2RlQXQoaSkpIDw8IDA7XG4gIH1cbiAgcmV0dXJuIE1hdGguYWJzKHJldCk7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIE1lc3NhZ2Uge1xuICBoZWFkZXI6IGhlYWRlci5IZWFkZXI7XG4gIGtleTogQnVmZmVyO1xuICB2YWw6IEJ1ZmZlcjtcbiAgZXh0cmFzOiBCdWZmZXI7XG59XG5cbmV4cG9ydCBjb25zdCBwYXJzZU1lc3NhZ2UgPSBmdW5jdGlvbiAoZGF0YUJ1ZjogQnVmZmVyKTogTWVzc2FnZSB8IGZhbHNlIHtcbiAgaWYgKGRhdGFCdWYubGVuZ3RoIDwgMjQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgY29uc3QgcmVzcG9uc2VIZWFkZXIgPSBoZWFkZXIuZnJvbUJ1ZmZlcihkYXRhQnVmKTtcblxuICBpZiAoXG4gICAgZGF0YUJ1Zi5sZW5ndGggPCByZXNwb25zZUhlYWRlci50b3RhbEJvZHlMZW5ndGggKyAyNCB8fFxuICAgIHJlc3BvbnNlSGVhZGVyLnRvdGFsQm9keUxlbmd0aCA8XG4gICAgICByZXNwb25zZUhlYWRlci5rZXlMZW5ndGggKyByZXNwb25zZUhlYWRlci5leHRyYXNMZW5ndGhcbiAgKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgbGV0IHBvaW50ZXIgPSAyNDtcbiAgY29uc3QgZXh0cmFzID0gZGF0YUJ1Zi5zbGljZShwb2ludGVyLCBwb2ludGVyICsgcmVzcG9uc2VIZWFkZXIuZXh0cmFzTGVuZ3RoKTtcbiAgcG9pbnRlciArPSByZXNwb25zZUhlYWRlci5leHRyYXNMZW5ndGg7XG4gIGNvbnN0IGtleSA9IGRhdGFCdWYuc2xpY2UocG9pbnRlciwgcG9pbnRlciArIHJlc3BvbnNlSGVhZGVyLmtleUxlbmd0aCk7XG4gIHBvaW50ZXIgKz0gcmVzcG9uc2VIZWFkZXIua2V5TGVuZ3RoO1xuICBjb25zdCB2YWwgPSBkYXRhQnVmLnNsaWNlKHBvaW50ZXIsIDI0ICsgcmVzcG9uc2VIZWFkZXIudG90YWxCb2R5TGVuZ3RoKTtcblxuICByZXR1cm4geyBoZWFkZXI6IHJlc3BvbnNlSGVhZGVyLCBrZXk6IGtleSwgZXh0cmFzOiBleHRyYXMsIHZhbDogdmFsIH07XG59O1xuXG5leHBvcnQgY29uc3QgcGFyc2VNZXNzYWdlcyA9IGZ1bmN0aW9uIChkYXRhQnVmOiBCdWZmZXIpOiBNZXNzYWdlW10ge1xuICBjb25zdCBtZXNzYWdlcyA9IFtdO1xuXG4gIGxldCBtZXNzYWdlOiBNZXNzYWdlO1xuXG4gIGRvIHtcbiAgICBtZXNzYWdlID0gZXhwb3J0cy5wYXJzZU1lc3NhZ2UoZGF0YUJ1Zik7XG4gICAgaWYgKG1lc3NhZ2UpIHtcbiAgICAgIG1lc3NhZ2VzLnB1c2gobWVzc2FnZSk7XG4gICAgICBjb25zdCBtZXNzYWdlTGVuZ3RoID0gbWVzc2FnZS5oZWFkZXIudG90YWxCb2R5TGVuZ3RoICsgMjQ7XG4gICAgICBkYXRhQnVmID0gZGF0YUJ1Zi5zbGljZShtZXNzYWdlTGVuZ3RoKTtcbiAgICB9XG4gIH0gd2hpbGUgKG1lc3NhZ2UpO1xuXG4gIHJldHVybiBtZXNzYWdlcztcbn07XG5cbmV4cG9ydCBjb25zdCBtZXJnZSA9IGZ1bmN0aW9uIDxUPihvcmlnaW5hbDogYW55LCBkZWZsdDogVCk6IFQge1xuICBmb3IgKGxldCBhdHRyVCBvZiBPYmplY3Qua2V5cyhkZWZsdCkpIHtcbiAgICBjb25zdCBhdHRyOiBrZXlvZiBUID0gYXR0clQgYXMgYW55O1xuICAgIGNvbnN0IG9yaWdpbmFsVmFsdWUgPSBvcmlnaW5hbFthdHRyXTtcblxuICAgIGlmIChvcmlnaW5hbFZhbHVlID09PSB1bmRlZmluZWQgfHwgb3JpZ2luYWxWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgb3JpZ2luYWxbYXR0cl0gPSBkZWZsdFthdHRyXSBhcyBhbnk7XG4gICAgfVxuICB9XG4gIHJldHVybiBvcmlnaW5hbDtcbn07XG5cbi8vIHRpbWVzdGFtcCBwcm92aWRlcyBhIG1vbm90b25pYyB0aW1lc3RhbXAgd2l0aCBtaWxsaXNlY29uZCBhY2N1cmFjeSwgdXNlZnVsXG4vLyBmb3IgdGltZXJzLlxuZXhwb3J0IGNvbnN0IHRpbWVzdGFtcCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdGltZXMgPSBwcm9jZXNzLmhydGltZSgpO1xuICByZXR1cm4gdGltZXNbMF0gKiAxMDAwICsgTWF0aC5yb3VuZCh0aW1lc1sxXSAvIDEwMDAwMDApO1xufTtcblxuaWYgKCFCdWZmZXIuY29uY2F0KSB7XG4gIEJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgbGVuZ3RoKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGxpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0LCBbbGVuZ3RoXSlcIik7XG4gICAgfVxuXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gQnVmZmVyLmFsbG9jKDApO1xuICAgIH1cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIHJldHVybiBsaXN0WzBdO1xuICAgIH1cblxuICAgIGxldCBpOiBudW1iZXI7XG4gICAgbGV0IGJ1ZjogQnVmZmVyO1xuXG4gICAgaWYgKHR5cGVvZiBsZW5ndGggIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGxlbmd0aCA9IDA7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICBidWYgPSBsaXN0W2ldO1xuICAgICAgICBsZW5ndGggKz0gYnVmLmxlbmd0aDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBidWZmZXIgPSBCdWZmZXIuYWxsb2MobGVuZ3RoKTtcbiAgICBsZXQgcG9zID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIGJ1ZiA9IGxpc3RbaV07XG4gICAgICBidWYuY29weShidWZmZXIsIHBvcyk7XG4gICAgICBwb3MgKz0gYnVmLmxlbmd0aDtcbiAgICB9XG4gICAgcmV0dXJuIGJ1ZmZlcjtcbiAgfTtcbn1cbiJdfQ==