# Smart Import for Zotero

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![license](https://img.shields.io/github/license/pgauding/zotero-smart-import?style=flat-square)](https://github.com/pgauding/zotero-smart-import/blob/main/LICENSE)

Import `.bib` files into Zotero **without creating duplicates**. The plugin matches each BibTeX entry against your existing library using DOI (exact) and fuzzy title/author/year scoring, then organizes everything into a new collection so you can see at a glance which items you already have and which you still need to fetch.

**Status: Alpha.** Core functionality works. Feedback welcome via [issues](https://github.com/pgauding/zotero-smart-import/issues) or on X.

## The Problem

You generate a `.bib` file (from Claude, from a collaborator, from a LaTeX project) and want to bring it into Zotero. Today, Zotero's built-in BibTeX import creates new items unconditionally — even for references you already own. You end up with dozens of duplicates to merge by hand.

## What This Plugin Does

1. **Parse** your `.bib` file
2. **Match** each entry against your existing Zotero library:
   - DOI exact match (when available)
   - Fuzzy title + author + year scoring (50/30/20 weights) when no DOI
3. **Create a new collection** containing:
   - Existing items that matched (no duplicates created)
   - New items for entries not found in your library
4. **Tag new items** `smart-import:new` so you can instantly filter to see what needs PDFs

## Installation

### From Release (Recommended)

1. Download the latest `.xpi` file from [Releases](https://github.com/pgauding/zotero-smart-import/releases)
2. In Zotero: **Tools > Add-ons > gear icon > Install Add-on From File...**
3. Select the downloaded `.xpi` file
4. Restart Zotero

### From Source

```bash
git clone https://github.com/pgauding/zotero-smart-import.git
cd zotero-smart-import
npm install
npm run build
```

The `.xpi` file will be at `.scaffold/build/smart-import-for-zotero.xpi`. Install it using the same steps as above.

## Usage

1. **File > Smart Import from .bib...**
2. Select your `.bib` file
3. Review the match diagnostics (shows how many matched, ambiguous, and new)
4. Enter a collection name (defaults to `Smart Import YYYY-MM-DD`)
5. The plugin creates the collection and navigates to it

### Reading the Results

In the new collection:

- Items **with PDF attachments** = you already had these
- Items **tagged `smart-import:new`** = newly created, you need to find and attach PDFs
- Items **without the tag and without PDFs** = matched to existing items that also lack PDFs

## How Matching Works

### DOI Match (Confidence: 1.0)

If the `.bib` entry has a DOI field, the plugin checks your library's DOI index for an exact match. This is the fastest and most reliable path.

### Fuzzy Match (Confidence: 0.0 - 1.0)

When no DOI is available, the plugin:

1. Builds a **title-word inverted index** of your library (only significant words > 3 characters, stop words excluded)
2. Finds **candidate items** that share at least one title word with the `.bib` entry
3. Scores each candidate using a weighted composite:
   - **50%** title similarity (token-sort Levenshtein ratio)
   - **30%** author similarity (token-set Levenshtein ratio)
   - **20%** year similarity (exact = 1.0, off-by-one = 0.5, else = 0.0)
4. Classifies the best score:
   - **>= 0.75**: matched (uses existing item)
   - **0.40 - 0.74**: ambiguous (created as new item for safety)
   - **< 0.40**: new (created via Zotero's BibTeX translator)

The fuzzy matching algorithm is ported from [citation-detection](https://github.com/pgauding/citation-detection).

## Preferences

**Tools > Add-ons > Smart Import > Preferences**

| Setting         | Default            | Description                                    |
| --------------- | ------------------ | ---------------------------------------------- |
| Match threshold | 75                 | Minimum confidence (0-100) to consider a match |
| Tag new items   | true               | Whether to tag items created by the import     |
| Tag name        | `smart-import:new` | The tag applied to new items                   |

## Requirements

- Zotero 7 or later

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the .xpi
npm run test:unit    # Run unit tests (50 tests, bibParser + fuzzy modules)
npm run lint:check   # Check formatting and lint
npm run lint:fix     # Auto-fix formatting and lint issues
```

## Known Limitations

- **Ambiguous matches are created as new items.** When the fuzzy score falls between 0.40 and 0.75, the plugin errs on the side of creating a new item rather than linking to a potentially wrong match. You can merge these manually in Zotero's Duplicate Items view.
- **No review dialog yet.** A future version will show ambiguous matches in a dialog where you can accept or reject each one before importing.
- **BibTeX only.** RIS, EndNote XML, and other formats are not supported.

## License

AGPL-3.0-or-later

## Acknowledgments

Built with [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template), [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit), and [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).

Fuzzy matching algorithm ported from [citation-detection](https://github.com/pgauding/citation-detection).
