export namespace noopSerializer {
    function serialize(opcode: any, value: any, extras: any): {
        value: any;
        extras: any;
    };
    function deserialize(opcode: any, value: any, extras: any): {
        value: any;
        extras: any;
    };
}
