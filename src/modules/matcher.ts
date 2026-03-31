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
 */
export async function matchEntries(
  entries: BibEntry[],
  libraryID: number,
): Promise<MatchResult[]> {
  const matchThreshold = (getPref("matchThreshold") as number) / 100;
  const ambiguousThreshold = (getPref("ambiguousThreshold") as number) / 100;

  const results: MatchResult[] = [];

  for (const entry of entries) {
    const result = await matchSingleEntry(
      entry,
      libraryID,
      matchThreshold,
      ambiguousThreshold,
    );
    results.push(result);
  }

  return results;
}

async function matchSingleEntry(
  entry: BibEntry,
  libraryID: number,
  matchThreshold: number,
  ambiguousThreshold: number,
): Promise<MatchResult> {
  ztoolkit.log(
    `Matching: "${entry.title?.substring(0, 50)}" doi=${entry.doi || "none"} year=${entry.year || "none"}`,
  );

  // 1. Try DOI exact match
  if (entry.doi) {
    const doiMatch = await findByDoi(entry.doi, libraryID);
    ztoolkit.log(`  DOI search for "${entry.doi}": ${doiMatch !== null ? `found ID ${doiMatch}` : "not found"}`);
    if (doiMatch !== null) {
      return {
        entry,
        status: "matched",
        confidence: 1.0,
        matchedItemId: doiMatch,
      };
    }
  }

  // 2. Fuzzy matching: search for candidates by title keywords
  const candidates = await findCandidates(entry, libraryID);
  if (candidates.length === 0) {
    return { entry, status: "new", confidence: 0.0, matchedItemId: null };
  }

  // 3. Score each candidate
  let bestScore = 0;
  let bestItemId: number | null = null;

  for (const candidateId of candidates) {
    const item = Zotero.Items.get(candidateId);
    if (!item || !item.isRegularItem()) continue;

    const score = scoreCandidate(entry, item);
    if (score > bestScore) {
      bestScore = score;
      bestItemId = candidateId;
    }
  }

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
 * Search for a Zotero item by DOI.
 * Returns the item ID if found, null otherwise.
 */
async function findByDoi(
  doi: string,
  libraryID: number,
): Promise<number | null> {
  // Try Zotero.Search with DOI condition
  try {
    const s = new Zotero.Search();
    (s as any).libraryID = libraryID;
    s.addCondition("DOI", "is", doi);
    const ids = await s.search();
    if (ids.length > 0) return ids[0];
  } catch {
    // DOI search condition may not be supported; fall back to SQL
  }

  // Fallback: direct DB query
  try {
    const fieldID = Zotero.ItemFields.getID("DOI");
    if (fieldID) {
      const sql = `
        SELECT items.itemID
        FROM items
        JOIN itemData USING (itemID)
        JOIN itemDataValues USING (valueID)
        WHERE items.libraryID = ?
          AND itemData.fieldID = ?
          AND LOWER(itemDataValues.value) = LOWER(?)
        LIMIT 1
      `;
      const id = await Zotero.DB.valueQueryAsync(sql, [
        libraryID,
        fieldID,
        doi,
      ]);
      if (id) return id as unknown as number;
    }
  } catch (err) {
    ztoolkit.log("DOI SQL fallback failed:", err);
  }

  return null;
}

/**
 * Find candidate items for fuzzy matching using quicksearch.
 * Returns an array of item IDs.
 */
async function findCandidates(
  entry: BibEntry,
  libraryID: number,
): Promise<number[]> {
  if (!entry.title) return [];

  // Use first few significant words of the title for quick search
  const keywords = entry.title
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .join(" ");

  if (!keywords) return [];

  try {
    const s = new Zotero.Search();
    (s as any).libraryID = libraryID;
    s.addCondition("quicksearch-titleCreatorYear", "contains", keywords);
    const ids = await s.search();
    // Limit candidates to prevent slow scoring on huge libraries
    return ids.slice(0, 50);
  } catch (err) {
    ztoolkit.log("Candidate search failed:", err);
    return [];
  }
}

/**
 * Score a candidate Zotero item against a BibEntry.
 * Returns a composite score from 0.0 to 1.0.
 */
function scoreCandidate(entry: BibEntry, item: any): number {
  // Title similarity
  const itemTitle = item.getField("title") || "";
  const titleScore = entry.title
    ? tokenSortRatio(entry.title, itemTitle)
    : 0;

  // Author similarity
  const creators = item.getCreators() || [];
  const itemAuthors = creators
    .filter(
      (c: any) =>
        c.creatorType === "author" || c.creatorType === "editor",
    )
    .map((c: any) => `${c.lastName || ""}, ${c.firstName || ""}`)
    .join("; ");
  const entryAuthors = entry.authors.join("; ");
  const authorScore =
    entryAuthors && itemAuthors
      ? tokenSetRatio(entryAuthors, itemAuthors)
      : 0;

  // Year similarity
  const itemYear =
    item.getField("year") ||
    item.getField("date")?.substring(0, 4) ||
    null;
  const yearScore = yearSimilarity(entry.year, itemYear);

  return (
    TITLE_WEIGHT * titleScore +
    AUTHOR_WEIGHT * authorScore +
    YEAR_WEIGHT * yearScore
  );
}
