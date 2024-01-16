"use strict";
// this is a copy of the consistant hash algorithm used by PECL memcache 4.0.5.2
// https://github.com/websupport-sk/pecl-memcache/blob/4.0.5.2/php7/memcache_consistent_hash.c
Object.defineProperty(exports, "__esModule", { value: true });
class HashRing {
    constructor(servers, algorithm) {
        this.weight = 1;
        this.MMC_CONSISTENT_POINTS = 160;
        this.MMC_CONSISTENT_BUCKETS = 1024;
        this.points = [];
        this.numPoints = 0;
        this.numServers = 0;
        this.bucketsPopulated = false;
        this.buckets = [];
        this.servers = servers;
        this.algorithm = algorithm;
        this.servers.forEach(server => {
            this.addServer(server);
        });
    }
    addServer(server) {
        var points = this.weight * this.MMC_CONSISTENT_POINTS;
        for (var i = 0; i < points; i++) {
            var key = `${server}-${i}`;
            var hash = this.algorithm(key);
            this.points[this.numPoints + i] = {
                server: server,
                point: hash
            };
        }
        this.numPoints += points;
        this.numServers++;
        this.bucketsPopulated = false;
    }
    populateBuckets() {
        var step = 0xffffffff / this.MMC_CONSISTENT_BUCKETS;
        this.points.sort((a, b) => {
            return a.point - b.point;
        });
        for (var i = 0; i < this.MMC_CONSISTENT_BUCKETS; i++) {
            this.buckets[i] = this.find(step * i);
        }
        this.bucketsPopulated = true;
    }
    find(point) {
        var lo = 0;
        var hi = this.numPoints - 1;
        var mid;
        while (true) {
            /* point is outside interval or lo >= hi, wrap-around */
            if (point <= this.points[lo].point || point > this.points[hi].point) {
                return this.points[lo].server;
            }
            /* test middle point */
            mid = lo + Math.floor((hi - lo) / 2);
            /* perfect match */
            if (point <= this.points[mid].point && point > (mid ? this.points[mid - 1].point : 0)) {
                return this.points[mid].server;
            }
            /* too low, go up */
            if (this.points[mid].point < point) {
                lo = mid + 1;
            }
            else {
                hi = mid - 1;
            }
        }
    }
    // was find_server() in PHP
    get(key) {
        if (this.numServers > 1) {
            if (!this.bucketsPopulated) {
                this.populateBuckets();
            }
            var hash = hash = this.algorithm(key);
            return this.buckets[hash % this.MMC_CONSISTENT_BUCKETS];
        }
        return this.points[0].server;
    }
    // Note: these functions are here for compatability with JS memcached NPM module
    // but should never be called in our use case
    // should not be called unless 'redundancy' and 'queryRedundancy' is set in Memcached
    range(key, size, unique) {
        throw '"range" call unsupported';
    }
    // should not be called unless 'failOverServers' is set in Memcached
    swap(from, to) {
        throw '"swap" call unsupported';
    }
    // should not be called as we do not want a server to not exist as it would
    // end up not finding keys anyway - we've never used it this way
    remove(server) {
        throw '"remove" call unsupported';
    }
}
exports.default = HashRing;
