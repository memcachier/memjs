export function makeRequestBuffer(opcode: any, key: any, extras: any, value: any, opaque: any): Buffer;
export function makeAmountInitialAndExpiration(amount: any, amountIfEmpty: any, expiration: any): Buffer;
export function makeExpiration(expiration: any): Buffer;
export function hashCode(str: any): number;
export function parseMessage(dataBuf: any): false | {
    header: {
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
    key: any;
    extras: any;
    val: any;
};
export function merge(original: any, deflt: any): any;
export function timestamp(): number;
