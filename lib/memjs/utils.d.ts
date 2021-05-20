/// <reference types="node" />
import * as header from "./header";
import { OP } from "./constants";
export declare type MaybeBuffer = string | Buffer;
export declare const bufferify: (val: MaybeBuffer) => Buffer;
export interface EncodableRequest {
    header: Omit<header.Header, "magic" | "keyLength" | "extrasLength" | "totalBodyLength">;
    key: MaybeBuffer;
    extras: MaybeBuffer;
    value: MaybeBuffer;
}
export declare function encodeRequestIntoBuffer(buffer: Buffer, offset: number, request: EncodableRequest): number;
export declare function encodeRequest(request: EncodableRequest): Buffer;
export declare const copyIntoRequestBuffer: (opcode: OP, key: MaybeBuffer, extras: MaybeBuffer, value: MaybeBuffer, opaque: number, buf: Buffer, _bufTargetWriteOffset?: number | undefined) => number;
export declare const makeRequestBuffer: (opcode: OP, key: MaybeBuffer, extras: MaybeBuffer, value: MaybeBuffer, opaque?: number | undefined) => Buffer;
export declare const makeAmountInitialAndExpiration: (amount: number, amountIfEmpty: number, expiration: number) => Buffer;
export declare const makeExpiration: (expiration: number) => Buffer;
export declare const hashCode: (str: string) => number;
export interface Message {
    header: header.Header;
    key: Buffer;
    val: Buffer;
    extras: Buffer;
}
export declare const parseMessage: (dataBuf: Buffer) => Message | false;
export declare const parseMessages: (dataBuf: Buffer) => Message[];
export declare const merge: <T>(original: any, deflt: T) => T;
export declare const timestamp: () => number;
//# sourceMappingURL=utils.d.ts.map