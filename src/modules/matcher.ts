/**
 * Library matching engine.
 * For each BibEntry, searches the user's Zotero library for matches
 * using DOI (exact) and fuzzy title/author/year scoring.
 *
 * Scoring weights ported from citation-detection scoring.py:
 *   0.50 * titleSimilarity + 0.30 * authorSimilarity + 0.20 * yearSimilarity
 *
 * Performance: builds a title-word inverted index so each .bib entry
 * only scores items that share at least one significant title word,
 * instead of scoring the entire library (~60 entries × ~5000 items
 * would beachball Zotero on the main thread).
 */

import { BibEntry } from "./bibParser";
import { tokenSortRatio, tokenSetRatio, yearSimilarity } from "./fuzzy";
import { getPref } from "../utils/prefs";

const TITLE_WEIGHT = 0.5;
const AUTHOR_WEIGHT = 0.3;
const YEAR_WEIGHT = 0.2;

/** Words too common to be useful for candidate filtering */
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "that",
  "this",
  "are",
  "was",
  "were",
  "been",
  "have",
  "has",
  "had",
  "not",
  "but",
  "its",
  "how",
  "why",
  "what",
  "when",
  "who",
  "new",
  "case",
  "about",
  "between",
  "into",
  "over",
  "under",
  "after",
  "before",
]);

export type MatchStatus = "matched" | "ambiguous" | "new";

export interface MatchResult {
  entry: BibEntry;
  status: MatchStatus;
  confidence: number;
  matchedItemId: number | null;
}

/** Pre-extracted item data to avoid repeated getField calls during scoring */
interface ItemRecord {
  id: number;
  title: string;
  authors: string;
  year: string | null;
}

/**
 * Match an array of BibEntries against the user's Zotero library.
 * Builds indexes upfront for DOI (exact) and title-word (candidate narrowing).
 */
export async function matchEntries(
  entries: BibEntry[],
  libraryID: number,
): Promise<MatchResult[]> {
  const matchThreshold = (getPref("matchThreshold") as number) / 100;
  const ambiguousThreshold = (getPref("ambiguousThreshold") as number) / 100;

  ztoolkit.log("Loading library items for matching...");
  const allItemIds = await Zotero.Items.getAll(libraryID, true, false);

  // Extract data from all items once
  const doiIndex = new Map<string, number>();
  const titleWordIndex = new Map<string, number[]>();
  const itemRecords = new Map<number, ItemRecord>();

  for (const row of allItemIds) {
    const id = typeof row === "number" ? row : (row as any).id;
    const item = Zotero.Items.get(id);
    if (!item || !item.isRegularItem()) continue;

    // Extract fields once
    let title = "";
    let authors = "";
    let year: string | null = null;
    try {
      title = item.getField("title") || "";
    } catch {
      continue;
    }
    try {
      const creators = item.getCreators() || [];
      authors = creators
        .filter(
          (c: any) => c.creatorType === "author" || c.creatorType === "editor",
        )
        .map((c: any) => `${c.lastName || ""}, ${c.firstName || ""}`)
        .join("; ");
    } catch {
      /* ignore */
    }
    try {
      year =
        item.getField("year") || item.getField("date")?.substring(0, 4) || null;
    } catch {
      /* ignore */
    }

    // DOI index
    try {
      const doi = item.getField("DOI");
      if (doi) {
        doiIndex.set(
          doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, ""),
          id,
        );
      }
    } catch {
      /* ignore */
    }

    // Title-word inverted index
    const words = significantWords(title);
    for (const w of words) {
      const existing = titleWordIndex.get(w);
      if (existing) {
        existing.push(id);
      } else {
        titleWordIndex.set(w, [id]);
      }
    }

    itemRecords.set(id, { id, title, authors, year });
  }

  ztoolkit.log(
    `Indexed ${itemRecords.size} items, ${doiIndex.size} DOIs, ${titleWordIndex.size} title words`,
  );

  // Match each entry
  const results: MatchResult[] = [];
  for (let i = 0; i < entries.length; i++) {
    const result = matchSingleEntry(
      entries[i],
      doiIndex,
      titleWordIndex,
      itemRecords,
      matchThreshold,
      ambiguousThreshold,
    );
    results.push(result);

    // Yield to event loop every 20 entries so Zotero UI doesn't freeze
    if (i % 20 === 19) {
      await Zotero.Promise.delay(0);
    }
  }

  return results;
}

function matchSingleEntry(
  entry: BibEntry,
  doiIndex: Map<string, number>,
  titleWordIndex: Map<string, number[]>,
  itemRecords: Map<number, ItemRecord>,
  matchThreshold: number,
  ambiguousThreshold: number,
): MatchResult {
  // 1. DOI exact match
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

  // 2. Find candidates via title-word index
  if (!entry.title) {
    return { entry, status: "new", confidence: 0.0, matchedItemId: null };
  }

  const queryWords = significantWords(entry.title);
  const candidateIds = new Set<number>();
  for (const w of queryWords) {
    const ids = titleWordIndex.get(w);
    if (ids) {
      for (const id of ids) candidateIds.add(id);
    }
  }

  if (candidateIds.size === 0) {
    ztoolkit.log(
      `  No candidates: "${entry.title?.substring(0, 40)}" (${queryWords.length} query words)`,
    );
    return { entry, status: "new", confidence: 0.0, matchedItemId: null };
  }

  // 3. Score only candidates (not the entire library)
  let bestScore = 0;
  let bestItemId: number | null = null;
  let bestTitle = "";

  for (const candidateId of candidateIds) {
    const rec = itemRecords.get(candidateId);
    if (!rec) continue;

    const score = scoreRecord(entry, rec);
    if (score > bestScore) {
      bestScore = score;
      bestItemId = candidateId;
      bestTitle = rec.title;
    }
  }

  ztoolkit.log(
    `  Fuzzy: "${entry.title?.substring(0, 40)}" candidates=${candidateIds.size} best=${bestScore.toFixed(2)} match="${bestTitle?.substring(0, 40)}"`,
  );

  // 4. Classify
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
 * Score a candidate item record against a BibEntry.
 * Uses pre-extracted data (no Zotero API calls during scoring).
 */
function scoreRecord(entry: BibEntry, rec: ItemRecord): number {
  const titleScore = entry.title ? tokenSortRatio(entry.title, rec.title) : 0;

  const entryAuthors = entry.authors.join("; ");
  const authorScore =
    entryAuthors && rec.authors ? tokenSetRatio(entryAuthors, rec.authors) : 0;

  const yearScore = yearSimilarity(entry.year, rec.year);

  return (
    TITLE_WEIGHT * titleScore +
    AUTHOR_WEIGHT * authorScore +
    YEAR_WEIGHT * yearScore
  );
}

/**
 * Extract significant lowercase words from a title (>3 chars, not stop words).
 */
function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}
