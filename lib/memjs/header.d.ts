export function fromBuffer(headerBuf: any): {
    magic?: undefined;
    opcode?: undefined;
    keyLength?: undefined;
    extrasLength?: undefined;
    dataType?: undefined;
    status?: undefined;
    totalBodyLength?: undefined;
    opaque?: undefined;
    cas?: undefined;
} | {
    magic: any;
    opcode: any;
    keyLength: any;
    extrasLength: any;
    dataType: any;
    status: any;
    totalBodyLength: any;
    opaque: any;
    cas: any;
};
export function toBuffer(header: any): Buffer;
