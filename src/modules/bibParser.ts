/**
 * Lightweight BibTeX parser for well-formed .bib files.
 * Extracts match keys (DOI, title, authors, year) from each entry.
 * Does NOT attempt to handle every BibTeX edge case — designed for
 * Claude-generated .bib output, which is consistently well-formed.
 */

export interface BibEntry {
  citekey: string;
  entryType: string;
  doi: string | null;
  title: string | null;
  authors: string[];
  year: string | null;
  rawBibtex: string;
  fields: Record<string, string>;
}

/**
 * Parse a .bib file string into structured entries.
 */
export function parseBibFile(content: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const entryRegex = /@(\w+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(content)) !== null) {
    const entryType = match[1].toLowerCase();

    // Skip @comment, @preamble, @string
    if (entryType === "comment" || entryType === "preamble" || entryType === "string") {
      continue;
    }

    const startPos = match.index;
    const bodyStart = match.index + match[0].length;
    const body = extractBracedBlock(content, bodyStart);
    if (body === null) continue;

    const rawBibtex = content.substring(startPos, bodyStart + body.length + 1);

    // Extract citekey: text before the first comma
    const commaIdx = body.indexOf(",");
    if (commaIdx === -1) continue;

    const citekey = body.substring(0, commaIdx).trim();
    const fieldsStr = body.substring(commaIdx + 1);

    const fields = parseFields(fieldsStr);

    const doi = normalizeDoi(fields["doi"] || null);
    const title = fields["title"] || null;
    const authors = parseAuthors(fields["author"] || "");
    const year = extractYear(fields["year"] || fields["date"] || null);

    entries.push({
      citekey,
      entryType,
      doi,
      title,
      authors,
      year,
      rawBibtex,
      fields,
    });
  }

  return entries;
}

/**
 * Extract a brace-delimited block from content starting just after the
 * opening brace. Returns the content between braces, or null if unbalanced.
 */
function extractBracedBlock(content: string, startAfterBrace: number): string | null {
  let depth = 1;
  let i = startAfterBrace;

  while (i < content.length && depth > 0) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
    if (depth > 0) i++;
  }

  if (depth !== 0) return null;
  return content.substring(startAfterBrace, i);
}

/**
 * Parse BibTeX field = value pairs from a fields string.
 * Handles both {braced} and "quoted" values, and bare numbers.
 */
function parseFields(fieldsStr: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let pos = 0;

  while (pos < fieldsStr.length) {
    // Skip whitespace and commas
    while (pos < fieldsStr.length && /[\s,]/.test(fieldsStr[pos])) pos++;
    if (pos >= fieldsStr.length) break;

    // Read field name
    const nameStart = pos;
    while (pos < fieldsStr.length && /[a-zA-Z0-9_-]/.test(fieldsStr[pos])) pos++;
    const fieldName = fieldsStr.substring(nameStart, pos).toLowerCase();
    if (!fieldName) break;

    // Skip whitespace and =
    while (pos < fieldsStr.length && /\s/.test(fieldsStr[pos])) pos++;
    if (pos >= fieldsStr.length || fieldsStr[pos] !== "=") break;
    pos++; // skip =
    while (pos < fieldsStr.length && /\s/.test(fieldsStr[pos])) pos++;
    if (pos >= fieldsStr.length) break;

    // Read value
    let value: string;
    if (fieldsStr[pos] === "{") {
      pos++; // skip opening brace
      const block = extractBracedBlock(fieldsStr, pos);
      if (block === null) break;
      value = block;
      pos += block.length + 1; // skip past closing brace
    } else if (fieldsStr[pos] === '"') {
      pos++; // skip opening quote
      const endQuote = fieldsStr.indexOf('"', pos);
      if (endQuote === -1) break;
      value = fieldsStr.substring(pos, endQuote);
      pos = endQuote + 1;
    } else {
      // Bare value (number or string concatenation)
      const valueStart = pos;
      while (pos < fieldsStr.length && fieldsStr[pos] !== "," && fieldsStr[pos] !== "}") {
        pos++;
      }
      value = fieldsStr.substring(valueStart, pos).trim();
    }

    // Strip LaTeX commands and clean up
    fields[fieldName] = cleanLatex(value);
  }

  return fields;
}

/**
 * Normalize a DOI string: lowercase, strip URL prefix.
 */
function normalizeDoi(doi: string | null): string | null {
  if (!doi) return null;
  let d = doi.trim().toLowerCase();
  // Strip URL prefix
  d = d.replace(/^https?:\/\/doi\.org\//, "");
  d = d.replace(/^doi:\s*/, "");
  // Validate it looks like a DOI
  if (/^10\.\d{4,}\//.test(d)) {
    return d;
  }
  return null;
}

/**
 * Parse BibTeX author field into array of "Last, First" strings.
 * Handles both "Last, First" and "First Last" formats.
 */
function parseAuthors(authorStr: string): string[] {
  if (!authorStr.trim()) return [];

  return authorStr
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .map((a) => {
      // Already in "Last, First" format
      if (a.includes(",")) {
        return a;
      }
      // "First Last" -> "Last, First"
      const parts = a.split(/\s+/);
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const first = parts.slice(0, -1).join(" ");
        return `${last}, ${first}`;
      }
      return a;
    });
}

/**
 * Extract a 4-digit year from a string.
 */
function extractYear(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : null;
}

/**
 * Minimal LaTeX cleanup: remove braces used for case protection,
 * common accent commands, etc.
 */
function cleanLatex(s: string): string {
  return s
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/\\\\/g, "")
    .replace(/\\textit\b/g, "")
    .replace(/\\textbf\b/g, "")
    .replace(/\\emph\b/g, "")
    .replace(/~+/g, " ")
    .trim();
}
