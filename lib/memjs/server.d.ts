/// <reference types="node" />
import net from "net";
import events from "events";
import { Message } from "./utils";
export interface ServerOptions {
    timeout: number;
    keepAlive: boolean;
    keepAliveDelay: number;
    conntimeout: number;
    username?: string;
    password?: string;
}
declare type Seq = number;
export interface OnConnectCallback {
    (socket: net.Socket): void;
}
export interface OnResponseCallback {
    (message: Message): void;
    quiet?: boolean;
}
export interface OnErrorCallback {
    (error: Error): void;
}
export declare class Server extends events.EventEmitter {
    responseBuffer: Buffer;
    host: string;
    port: string | number | undefined;
    connected: boolean;
    timeoutSet: boolean;
    connectCallbacks: OnConnectCallback[];
    responseCallbacks: {
        [seq: string]: OnResponseCallback;
    };
    requestTimeouts: number[];
    errorCallbacks: {
        [seq: string]: OnErrorCallback;
    };
    options: ServerOptions;
    username: string | undefined;
    password: string | undefined;
    _socket: net.Socket | undefined;
    constructor(host: string, port?: string | number, username?: string, password?: string, options?: Partial<ServerOptions>);
    onConnect(func: OnConnectCallback): void;
    onResponse(seq: Seq, func: OnResponseCallback): void;
    respond(response: Message): void;
    onError(seq: Seq, func: OnErrorCallback): void;
    error(err: Error): void;
    listSasl(): void;
    saslAuth(): void;
    appendToBuffer(dataBuf: Buffer): Buffer;
    responseHandler(dataBuf: Buffer): void;
    sock(sasl: boolean, go: OnConnectCallback): void;
    write(blob: Buffer): void;
    writeSASL(blob: Buffer): void;
    close(): void;
    toString(): string;
    hostportString(): string;
}
export {};
//# sourceMappingURL=server.d.ts.map