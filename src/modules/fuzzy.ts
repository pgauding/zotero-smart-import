/**
 * String similarity primitives for bibliographic matching.
 * Ported from citation-detection/src/citation_detection/scoring.py
 *
 * Implements Levenshtein-based token_sort_ratio and token_set_ratio,
 * matching the behavior of rapidfuzz's equivalents.
 */

/**
 * Levenshtein edit distance between two strings.
 * Standard dynamic programming implementation.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use single-row optimization for space
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Levenshtein similarity ratio: 0.0 (completely different) to 1.0 (identical).
 */
export function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Token Sort Ratio: tokenize both strings, sort tokens alphabetically,
 * rejoin, then compute Levenshtein ratio.
 *
 * Handles word reordering: "machine learning deep" matches "deep learning machine".
 * Equivalent to rapidfuzz.fuzz.token_sort_ratio().
 */
export function tokenSortRatio(a: string, b: string): number {
  const sortedA = tokenize(a).sort().join(" ");
  const sortedB = tokenize(b).sort().join(" ");
  return levenshteinRatio(sortedA, sortedB);
}

/**
 * Token Set Ratio: tokenize into sets, compute intersection and differences,
 * then return the maximum of pairwise comparisons.
 *
 * More permissive than tokenSortRatio — handles partial author names,
 * missing middle initials, etc.
 * Equivalent to rapidfuzz.fuzz.token_set_ratio().
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  const intersection: string[] = [];
  const diffA: string[] = [];
  const diffB: string[] = [];

  for (const t of tokensA) {
    if (tokensB.has(t)) intersection.push(t);
    else diffA.push(t);
  }
  for (const t of tokensB) {
    if (!tokensA.has(t)) diffB.push(t);
  }

  const sorted_intersection = intersection.sort().join(" ");
  const combined_a = [sorted_intersection, ...diffA.sort()].join(" ").trim();
  const combined_b = [sorted_intersection, ...diffB.sort()].join(" ").trim();

  // Return max of: intersection vs combined_a, intersection vs combined_b,
  // and combined_a vs combined_b
  return Math.max(
    levenshteinRatio(sorted_intersection, combined_a),
    levenshteinRatio(sorted_intersection, combined_b),
    levenshteinRatio(combined_a, combined_b),
  );
}

/**
 * Year similarity: exact=1.0, off-by-one=0.5, else=0.0.
 * Ported from scoring.py lines 51-64.
 */
export function yearSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0.0;
  const ya = parseInt(a, 10);
  const yb = parseInt(b, 10);
  if (isNaN(ya) || isNaN(yb)) return 0.0;
  if (ya === yb) return 1.0;
  if (Math.abs(ya - yb) === 1) return 0.5;
  return 0.0;
}

/**
 * Tokenize a string: lowercase, split on non-alphanumeric, filter empties.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}
