const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const projectIdPrefixes = [
  "ses",
  "evt",
  "cmd",
  "req",
  "rsp",
  "pty",
  "art",
  "ply",
  "inf",
  "clm",
] as const;

export type ProjectIdPrefix = (typeof projectIdPrefixes)[number];

declare const projectIdBrand: unique symbol;
export type ProjectId<Prefix extends ProjectIdPrefix = ProjectIdPrefix> = `${Prefix}_${string}` & {
  readonly [projectIdBrand]: Prefix;
};

export interface UuidV7Source {
  readonly nowMs: number;
  readonly randomBytes: Uint8Array;
}

export function isUuidV7(value: string): boolean {
  return uuidV7Pattern.test(value);
}

export function isProjectId<Prefix extends ProjectIdPrefix>(
  value: string,
  prefix: Prefix,
): value is ProjectId<Prefix> {
  return value.startsWith(`${prefix}_`) && isUuidV7(value.slice(prefix.length + 1));
}

export function parseProjectId<Prefix extends ProjectIdPrefix>(
  value: string,
  prefix: Prefix,
): ProjectId<Prefix> {
  if (!isProjectId(value, prefix)) {
    throw new TypeError(`Expected ${prefix}_ followed by a lowercase UUIDv7`);
  }
  return value;
}

/**
 * Creates a sortable UUIDv7-backed project ID from caller-owned entropy.
 * Injecting time and randomness keeps this package deterministic and runtime-neutral.
 */
export function createProjectId<Prefix extends ProjectIdPrefix>(
  prefix: Prefix,
  source: UuidV7Source,
): ProjectId<Prefix> {
  if (!Number.isSafeInteger(source.nowMs) || source.nowMs < 0 || source.nowMs > 0xffffffffffff) {
    throw new RangeError("nowMs must be a non-negative 48-bit integer");
  }
  if (source.randomBytes.byteLength !== 10) {
    throw new RangeError("randomBytes must contain exactly 10 bytes");
  }

  const bytes = new Uint8Array(16);
  let timestamp = source.nowMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes.set(source.randomBytes, 6);
  // RFC 9562 fixes the version and variant while retaining 74 random bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return parseProjectId(`${prefix}_${uuid}`, prefix);
}
