/**
 * Minimal LRU cache on Map insertion order: reads refresh recency, writes
 * evict the least-recently-used entry once capacity is reached.
 */
export class LruCache<K, V> {
  private readonly capacity: number;
  private readonly entries = new Map<K, V>();

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`LruCache capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) {
      return undefined;
    }
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, value);
  }

  get size(): number {
    return this.entries.size;
  }
}
