import { OP } from "./constants";
import { MaybeBuffer } from "./utils";

interface Serializer<Value, Extras> {
  serialize(
    opcode: OP,
    value: Value,
    extras: Extras
  ): { value: MaybeBuffer; extras: MaybeBuffer };
  deserialize(
    opcode: OP,
    value: MaybeBuffer,
    extras: MaybeBuffer
  ): { value: Value; extras: Extras };
}

export const noopSerializer: Serializer<MaybeBuffer, MaybeBuffer> = {
  serialize: function (opcode, value, extras) {
    return { value: value, extras: extras };
  },
  deserialize: function (opcode, value, extras) {
    return { value: value, extras: extras };
  },
};
