/**
 * Library matching engine.
 * For each BibEntry, searches the user's Zotero library for matches
 * using DOI (exact) and fuzzy title/author/year scoring.
 *
 * Scoring weights ported from citation-detection scoring.py:
 *   0.50 * titleSimilarity + 0.30 * authorSimilarity + 0.20 * yearSimilarity
 */

import { BibEntry } from "./bibParser";
import { tokenSortRatio, tokenSetRatio, yearSimilarity } from "./fuzzy";
import { getPref } from "../utils/prefs";

const TITLE_WEIGHT = 0.5;
const AUTHOR_WEIGHT = 0.3;
const YEAR_WEIGHT = 0.2;

export type MatchStatus = "matched" | "ambiguous" | "new";

export interface MatchResult {
  entry: BibEntry;
  status: MatchStatus;
  confidence: number;
  matchedItemId: number | null;
}

/**
 * Match an array of BibEntries against the user's Zotero library.
 * Loads all library items once upfront to avoid per-entry search API issues.
 */
export async function matchEntries(
  entries: BibEntry[],
  libraryID: number,
): Promise<MatchResult[]> {
  const matchThreshold = (getPref("matchThreshold") as number) / 100;
  const ambiguousThreshold = (getPref("ambiguousThreshold") as number) / 100;

  // Load all regular items once — avoids per-entry Zotero.Search calls
  // which may not work reliably for all condition types
  ztoolkit.log("Loading all library items for matching...");
  const allItemIds = await Zotero.Items.getAll(libraryID, true, false);
  const allItems: any[] = [];
  for (const row of allItemIds) {
    const id = typeof row === "number" ? row : (row as any).id;
    const item = Zotero.Items.get(id);
    if (item && item.isRegularItem()) {
      allItems.push(item);
    }
  }
  ztoolkit.log(`Loaded ${allItems.length} regular items from library`);

  // Build a DOI index for fast exact matching
  const doiIndex = new Map<string, number>();
  for (const item of allItems) {
    try {
      const doi = item.getField("DOI");
      if (doi) {
        doiIndex.set(
          doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, ""),
          item.id,
        );
      }
    } catch {
      // Some item types don't have DOI field
    }
  }
  ztoolkit.log(`Built DOI index with ${doiIndex.size} entries`);

  const results: MatchResult[] = [];

  for (const entry of entries) {
    const result = matchSingleEntry(
      entry,
      allItems,
      doiIndex,
      matchThreshold,
      ambiguousThreshold,
    );
    results.push(result);
  }

  return results;
}

function matchSingleEntry(
  entry: BibEntry,
  allItems: any[],
  doiIndex: Map<string, number>,
  matchThreshold: number,
  ambiguousThreshold: number,
): MatchResult {
  // 1. Try DOI exact match
  if (entry.doi) {
    const matchedId = doiIndex.get(entry.doi);
    if (matchedId !== undefined) {
      ztoolkit.log(
        `  DOI match: "${entry.title?.substring(0, 40)}" -> item ${matchedId}`,
      );
      return {
        entry,
        status: "matched",
        confidence: 1.0,
        matchedItemId: matchedId,
      };
    }
  }

  // 2. Fuzzy matching against all items
  if (!entry.title) {
    return { entry, status: "new", confidence: 0.0, matchedItemId: null };
  }

  let bestScore = 0;
  let bestItemId: number | null = null;
  let bestTitle = "";

  for (const item of allItems) {
    const score = scoreCandidate(entry, item);
    if (score > bestScore) {
      bestScore = score;
      bestItemId = item.id;
      try {
        bestTitle = item.getField("title") || "";
      } catch {
        bestTitle = "";
      }
    }
  }

  ztoolkit.log(
    `  Fuzzy: "${entry.title?.substring(0, 40)}" best=${bestScore.toFixed(2)} match="${bestTitle?.substring(0, 40)}"`,
  );

  // 3. Classify
  if (bestScore >= matchThreshold && bestItemId !== null) {
    return {
      entry,
      status: "matched",
      confidence: bestScore,
      matchedItemId: bestItemId,
    };
  }
  if (bestScore >= ambiguousThreshold && bestItemId !== null) {
    return {
      entry,
      status: "ambiguous",
      confidence: bestScore,
      matchedItemId: bestItemId,
    };
  }
  return { entry, status: "new", confidence: bestScore, matchedItemId: null };
}

/**
 * Score a candidate Zotero item against a BibEntry.
 * Returns a composite score from 0.0 to 1.0.
 */
function scoreCandidate(entry: BibEntry, item: any): number {
  // Title similarity
  let itemTitle = "";
  try {
    itemTitle = item.getField("title") || "";
  } catch {
    return 0;
  }

  const titleScore = entry.title ? tokenSortRatio(entry.title, itemTitle) : 0;

  // Author similarity
  let itemAuthors = "";
  try {
    const creators = item.getCreators() || [];
    itemAuthors = creators
      .filter(
        (c: any) => c.creatorType === "author" || c.creatorType === "editor",
      )
      .map((c: any) => `${c.lastName || ""}, ${c.firstName || ""}`)
      .join("; ");
  } catch {
    // ignore
  }
  const entryAuthors = entry.authors.join("; ");
  const authorScore =
    entryAuthors && itemAuthors ? tokenSetRatio(entryAuthors, itemAuthors) : 0;

  // Year similarity
  let itemYear: string | null = null;
  try {
    itemYear =
      item.getField("year") || item.getField("date")?.substring(0, 4) || null;
  } catch {
    // ignore
  }
  const yearScore = yearSimilarity(entry.year, itemYear);

  return (
    TITLE_WEIGHT * titleScore +
    AUTHOR_WEIGHT * authorScore +
    YEAR_WEIGHT * yearScore
  );
}
