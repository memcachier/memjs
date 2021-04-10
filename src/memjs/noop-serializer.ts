import { OP } from "./constants";
import { MaybeBuffer } from "./utils";

export interface SerializerResult<Value, Extras> {
  value: Value;
  extras: Extras;
}

export interface Serializer<Value, Extras> {
  serialize(
    opcode: OP,
    value: Value,
    extras: MaybeBuffer
  ): SerializerResult<MaybeBuffer, MaybeBuffer>;
  deserialize(
    opcode: OP,
    value: MaybeBuffer,
    extras: MaybeBuffer
  ): SerializerResult<Value, Extras>;
}

export const noopSerializer: Serializer<MaybeBuffer, MaybeBuffer> = {
  serialize: function (opcode, value, extras) {
    return { value: value, extras: extras };
  },
  deserialize: function (opcode, value, extras) {
    return { value: value, extras: extras };
  },
};
