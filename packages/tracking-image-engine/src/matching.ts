const POPCOUNT: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let value = 1; value < 256; value += 1) table[value] = (value & 1) + table[value >> 1];
  return table;
})();

export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) distance += POPCOUNT[a[index] ^ b[index]];
  return distance;
}

export interface Match { readonly query: number; readonly train: number; readonly distance: number; }

export interface MatchOptions {
  /** Best match must be closer than `ratio` × second best (Lowe's ratio test). */
  ratio: number;
  maxDistance: number;
}

/** Brute-force nearest-neighbour matching of binary descriptors with a ratio test. */
export function matchDescriptors(query: readonly Uint8Array[], train: readonly Uint8Array[], options: MatchOptions): Match[] {
  const matches: Match[] = [];
  for (let q = 0; q < query.length; q += 1) {
    let best = Infinity, second = Infinity, bestIndex = -1;
    for (let t = 0; t < train.length; t += 1) {
      const distance = hammingDistance(query[q], train[t]);
      if (distance < best) { second = best; best = distance; bestIndex = t; }
      else if (distance < second) second = distance;
    }
    if (bestIndex >= 0 && best <= options.maxDistance && best < options.ratio * second) matches.push({ query: q, train: bestIndex, distance: best });
  }
  return matches;
}
