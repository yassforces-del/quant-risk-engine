export class LRUCache<T> {
  private cache: Map<string, T> = new Map();
  private max: number;

  constructor(max: number = 50) {
    this.max = max;
  }

  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (item) {
      // Refresh la position (LRU)
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.max) {
      // Supprime le plus ancien
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}
