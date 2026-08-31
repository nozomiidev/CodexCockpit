export class BoundedByteRing {
  readonly #capacity: number;
  #chunks: Uint8Array[] = [];
  #byteLength = 0;
  #droppedByteCount = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError("capacity must be positive");
    this.#capacity = capacity;
  }

  get byteLength(): number {
    return this.#byteLength;
  }
  get droppedByteCount(): number {
    return this.#droppedByteCount;
  }

  push(input: Uint8Array): void {
    const chunk = Uint8Array.from(input);
    if (chunk.byteLength >= this.#capacity) {
      this.#droppedByteCount += this.#byteLength + chunk.byteLength - this.#capacity;
      this.#chunks = [chunk.slice(chunk.byteLength - this.#capacity)];
      this.#byteLength = this.#capacity;
      return;
    }
    this.#chunks.push(chunk);
    this.#byteLength += chunk.byteLength;
    while (this.#byteLength > this.#capacity) {
      const first = this.#chunks[0];
      if (first === undefined) break;
      const excess = this.#byteLength - this.#capacity;
      if (first.byteLength <= excess) {
        this.#chunks.shift();
        this.#byteLength -= first.byteLength;
        this.#droppedByteCount += first.byteLength;
      } else {
        this.#chunks[0] = first.slice(excess);
        this.#byteLength -= excess;
        this.#droppedByteCount += excess;
      }
    }
  }

  snapshot(): Uint8Array {
    const result = new Uint8Array(this.#byteLength);
    let offset = 0;
    for (const chunk of this.#chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
}
