/**
 * Smart Import orchestrator.
 * Main workflow: file pick -> parse -> match -> create collection -> import.
 */

import { parseBibFile } from "./bibParser";
import { matchEntries, MatchResult } from "./matcher";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

// BibTeX translator ID (stable across Zotero versions)
const BIBTEX_TRANSLATOR_ID = "9cb70025-a888-4a29-a210-93ec52da40d4";

/**
 * Run the full smart import workflow.
 */
export async function runSmartImport(): Promise<void> {
  const win = Zotero.getMainWindow();

  // 1. Pick .bib file
  const filePath = await pickBibFile();
  if (!filePath) return; // user cancelled

  // 2. Read file
  const content = (await Zotero.File.getContentsAsync(filePath)) as string;
  if (!content || !content.trim()) {
    Zotero.alert(
      win as unknown as Window,
      "Smart Import",
      getString("import-error-no-entries"),
    );
    return;
  }

  // 3. Parse
  const entries = parseBibFile(content);
  if (entries.length === 0) {
    Zotero.alert(
      win as unknown as Window,
      "Smart Import",
      getString("import-error-no-entries"),
    );
    return;
  }

  ztoolkit.log(`Parsed ${entries.length} entries from .bib file`);

  // 4. Match against library
  const libraryID = Zotero.Libraries.userLibraryID;
  const popupWin = new ztoolkit.ProgressWindow("Smart Import", {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: getString("import-progress-matching"),
      type: "default",
      progress: 0,
    })
    .show();

  const results = await matchEntries(entries, libraryID);

  const matched = results.filter((r) => r.status === "matched");
  const ambiguous = results.filter((r) => r.status === "ambiguous");
  const newEntries = results.filter((r) => r.status === "new");

  ztoolkit.log(
    `Match results: ${matched.length} matched, ${ambiguous.length} ambiguous, ${newEntries.length} new`,
  );

  popupWin.changeLine({
    progress: 50,
    text: `${matched.length} matched, ${newEntries.length + ambiguous.length} to create...`,
  });

  // 5. Prompt for collection name
  const defaultName = `Smart Import ${new Date().toISOString().slice(0, 10)}`;
  const collectionName = promptForCollectionName(defaultName);
  if (!collectionName) {
    popupWin.close();
    return; // user cancelled
  }

  // 6. Create collection
  const collection = new Zotero.Collection();
  (collection as any).libraryID = libraryID;
  collection.name = collectionName;
  await collection.saveTx();

  // 7. Add matched items to collection
  for (const result of matched) {
    if (result.matchedItemId !== null) {
      await collection.addItem(result.matchedItemId);
    }
  }

  // 8. Import unmatched items via Zotero's BibTeX translator
  const toCreate = [...newEntries, ...ambiguous];
  let createdCount = 0;
  if (toCreate.length > 0) {
    popupWin.changeLine({
      progress: 70,
      text: getString("import-progress-importing"),
    });

    createdCount = await importNewEntries(toCreate, libraryID, collection.id);
  }

  // 9. Tag new items in the collection that weren't matched
  const shouldTag = getPref("tagNewItems") as boolean;
  const tagName = getPref("newItemTag") as string;
  if (shouldTag && tagName && createdCount > 0) {
    await tagNewItemsInCollection(collection.id, matched, tagName);
  }

  // 10. Show summary
  popupWin.changeLine({
    progress: 100,
    text: buildSummary(matched.length, createdCount, ambiguous.length),
  });
  popupWin.startCloseTimer(8000);

  // 11. Navigate to the new collection
  const zp = Zotero.getActiveZoteroPane();
  if (zp && zp.collectionsView) {
    await (zp.collectionsView as any).selectCollection(collection.id);
  }
}

/**
 * Tag items in the collection that aren't in the matched set.
 * Uses proper Zotero.Items.getAsync() to get full Item objects.
 */
async function tagNewItemsInCollection(
  collectionId: number,
  matched: MatchResult[],
  tagName: string,
): Promise<void> {
  const matchedIds = new Set(
    matched.map((r) => r.matchedItemId).filter((id) => id !== null),
  );

  const collection = Zotero.Collections.get(collectionId);
  if (!collection) return;

  const childItemIds = collection.getChildItems(true);
  for (const itemId of childItemIds) {
    if (!matchedIds.has(itemId)) {
      try {
        const item = Zotero.Items.get(itemId);
        if (item && item.isRegularItem()) {
          item.addTag(tagName);
          await item.saveTx();
        }
      } catch (err) {
        ztoolkit.log(`Failed to tag item ${itemId}: ${err}`);
      }
    }
  }
}

/**
 * Open a file picker filtered to .bib files.
 * Returns the selected file path, or null if cancelled.
 */
async function pickBibFile(): Promise<string | null> {
  const fp = (Components.classes as any)[
    "@mozilla.org/filepicker;1"
  ].createInstance(Components.interfaces.nsIFilePicker);
  const win = Zotero.getMainWindow();
  // Zotero 7 (Firefox 115): init() expects a BrowsingContext, not a Window
  fp.init(
    (win as any).browsingContext,
    "Select .bib File",
    Components.interfaces.nsIFilePicker.modeOpen,
  );
  fp.appendFilter("BibTeX Files", "*.bib");
  fp.appendFilters(Components.interfaces.nsIFilePicker.filterAll);

  return new Promise((resolve) => {
    fp.open((result: number) => {
      if (result === Components.interfaces.nsIFilePicker.returnOK && fp.file) {
        resolve(fp.file.path);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Prompt user for a collection name.
 * Returns the name or null if cancelled.
 */
function promptForCollectionName(defaultName: string): string | null {
  const result = { value: defaultName };
  const ok = Services.prompt.prompt(
    Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
    "Smart Import",
    "Collection name:",
    result,
    null as unknown as string,
    {} as { value: boolean },
  );
  return ok ? result.value : null;
}

/**
 * Import new entries using Zotero's built-in BibTeX translator.
 * Returns the count of items created.
 */
async function importNewEntries(
  results: MatchResult[],
  libraryID: number,
  collectionId: number,
): Promise<number> {
  // Reconstruct a .bib string from the raw BibTeX of unmatched entries
  const bibString = results.map((r) => r.entry.rawBibtex).join("\n\n");

  ztoolkit.log(`Importing ${results.length} entries via BibTeX translator...`);

  try {
    const translation = new Zotero.Translate.Import();
    translation.setString(bibString);

    // Let Zotero detect the right translator rather than hardcoding an ID
    const translators = await translation.getTranslators();
    if (!translators || translators.length === 0) {
      ztoolkit.log("No BibTeX translator found, trying hardcoded ID...");
      translation.setTranslator(BIBTEX_TRANSLATOR_ID);
    } else {
      ztoolkit.log(
        `Found translator: ${translators[0].label} (${translators[0].translatorID})`,
      );
      translation.setTranslator(translators[0]);
    }

    let itemCount = 0;
    translation.setHandler("itemDone", () => {
      itemCount++;
    });
    translation.setHandler("error", (_obj: any, err: any) => {
      ztoolkit.log(`Translator error: ${err}`);
    });

    await translation.translate({
      libraryID,
      collections: [collectionId],
    });

    ztoolkit.log(`Import complete: ${itemCount} items created`);
    return itemCount;
  } catch (err) {
    ztoolkit.log(`Import failed: ${err}`);
    // Don't throw — let the workflow continue to show partial results
    return 0;
  }
}

/**
 * Build a human-readable summary string.
 */
function buildSummary(
  matched: number,
  created: number,
  ambiguous: number,
): string {
  const parts: string[] = [];
  if (matched > 0) {
    parts.push(
      getString("import-summary-matched", { args: { count: matched } }),
    );
  }
  if (created > 0) {
    parts.push(
      getString("import-summary-created", { args: { count: created } }),
    );
  }
  if (ambiguous > 0) {
    parts.push(
      getString("import-summary-ambiguous", { args: { count: ambiguous } }),
    );
  }
  return parts.join(", ") || "No entries processed";
}
