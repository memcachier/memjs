/// <reference types="node" />
import { OP, ResponseStatus } from "./constants";
export interface Header {
    magic: number;
    opcode: OP;
    keyLength: number;
    extrasLength: number;
    dataType?: number;
    status?: ResponseStatus;
    totalBodyLength: number;
    opaque: number;
    cas?: Buffer;
}
/** fromBuffer converts a serialized header to a JS object. */
export declare function fromBuffer(headerBuf: Buffer): Header;
/** toBuffer converts a JS memcache header object to a binary memcache header */
export declare function toBuffer(header: Header): Buffer;
//# sourceMappingURL=header.d.ts.map