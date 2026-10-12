import { createHash } from "node:crypto";

// Same UUID for the same name on every run, so test URLs and saved ids survive a reseed.
export function stableUuid(name: string): string {
  const hex = createHash("sha256").update(`job-seed:${name}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Small deterministic PRNG (mulberry32): the generated offers are the same on every run.
export function createRandom(seed: number) {
  let state = seed;

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(items: readonly T[]): T {
    return items[Math.floor(next() * items.length)];
  }

  function weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  function sample<T>(items: readonly T[], count: number): T[] {
    const copy = [...items];
    const result: T[] = [];
    while (result.length < count && copy.length > 0) {
      result.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
    }
    return result;
  }

  return { next, int, pick, weighted, sample, chance: (p: number) => next() < p };
}

export type Random = ReturnType<typeof createRandom>;

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}
