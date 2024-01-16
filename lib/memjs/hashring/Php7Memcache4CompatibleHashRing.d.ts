import HashRingInterface from './HashRingInterface';
import { AlgorithmFunc } from './HashRingInterface';
export default class HashRing implements HashRingInterface {
    private servers;
    private algorithm;
    private weight;
    private readonly MMC_CONSISTENT_POINTS;
    private readonly MMC_CONSISTENT_BUCKETS;
    private points;
    private numPoints;
    private numServers;
    private bucketsPopulated;
    private buckets;
    constructor(servers: Array<string>, algorithm: AlgorithmFunc);
    private addServer;
    private populateBuckets;
    private find;
    get(key: string): string;
    range(key: string, size: number, unique: boolean): void;
    swap(from: string, to: string): void;
    remove(server: string): void;
}
