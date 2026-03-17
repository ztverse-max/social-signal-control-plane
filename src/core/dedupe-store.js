export class DedupeStore {
  constructor({ maxSize = 10_000 } = {}) {
    this.maxSize = maxSize;
    this.entries = new Map();
  }

  has(key) {
    return this.entries.has(key);
  }

  add(key, value = {}) {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      ...value,
      seenAt: Date.now()
    });

    while (this.entries.size > this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }
}
