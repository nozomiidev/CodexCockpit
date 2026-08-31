import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BoundedByteRing } from "../src/index.js";

describe("BoundedByteRing", () => {
  it("retains the newest bytes and reports dropped bytes", () => {
    const ring = new BoundedByteRing(4);
    ring.push(Uint8Array.from([1, 2, 3]));
    ring.push(Uint8Array.from([4, 5, 6]));
    expect([...ring.snapshot()]).toEqual([3, 4, 5, 6]);
    expect(ring.droppedByteCount).toBe(2);
  });

  it("copies and truncates a single oversized chunk", () => {
    const input = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    const ring = new BoundedByteRing(3);
    ring.push(input);
    input.fill(9);
    expect([...ring.snapshot()]).toEqual([3, 4, 5]);
    expect(ring.byteLength).toBe(3);
    expect(ring.droppedByteCount).toBe(3);
  });

  it("matches the suffix of arbitrary byte streams", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 128 }),
        fc.array(fc.uint8Array({ maxLength: 64 }), { maxLength: 30 }),
        (capacity, chunks) => {
          const ring = new BoundedByteRing(capacity);
          for (const chunk of chunks) ring.push(chunk);
          const all = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
          expect(ring.snapshot()).toEqual(all.slice(Math.max(0, all.length - capacity)));
          expect(ring.droppedByteCount).toBe(Math.max(0, all.length - capacity));
        },
      ),
      { seed: 0xb17e },
    );
  });
});
