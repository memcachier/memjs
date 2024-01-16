export type AlgorithmFunc = (key: string) => number;
export default abstract class HashRingInterface {
    constructor(servers: Array<string>, algorithm: AlgorithmFunc);
    abstract get(key: string): string;
}
