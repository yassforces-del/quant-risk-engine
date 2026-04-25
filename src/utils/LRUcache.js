"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LRUCache = void 0;
class LRUCache {
    constructor(max = 50) {
        this.cache = new Map();
        this.max = max;
    }
    get(key) {
        const item = this.cache.get(key);
        if (item) {
            // Refresh la position (LRU)
            this.cache.delete(key);
            this.cache.set(key, item);
        }
        return item;
    }
    set(key, value) {
        if (this.cache.size >= this.max) {
            // Supprime le plus ancien
            const firstKey = this.cache.keys().next().value;
            if (firstKey)
                this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
}
exports.LRUCache = LRUCache;
