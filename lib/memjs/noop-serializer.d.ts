import { OP } from "./constants";
import { MaybeBuffer } from "./utils";
export interface SerializerResult<Value, Extras> {
    value: Value;
    extras: Extras;
}
export interface Serializer<Value, Extras> {
    serialize(opcode: OP, value: Value, extras: MaybeBuffer): SerializerResult<MaybeBuffer, MaybeBuffer>;
    deserialize(opcode: OP, value: MaybeBuffer, extras: MaybeBuffer): SerializerResult<Value, Extras>;
}
export declare const noopSerializer: Serializer<MaybeBuffer, MaybeBuffer>;
//# sourceMappingURL=noop-serializer.d.ts.map