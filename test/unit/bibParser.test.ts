import { assert } from "chai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseBibFile } from "../../src/modules/bibParser";

// Load the test fixture .bib file (bundled in the repo)
const __dirname = dirname(fileURLToPath(import.meta.url));
const GUNS_BIB = readFileSync(
  join(__dirname, "../fixtures/guns-state-viol.bib"),
  "utf-8",
);

describe("bibParser", function () {
  let entries: ReturnType<typeof parseBibFile>;

  before(function () {
    entries = parseBibFile(GUNS_BIB);
  });

  it("should parse all entries from the .bib file", function () {
    // File has entries from @article and @book types, no @comment/@preamble
    assert.isAbove(entries.length, 50, "should find at least 50 entries");
  });

  it("should skip %% comment lines without creating entries", function () {
    const citekeys = entries.map((e) => e.citekey);
    assert.notInclude(citekeys, "");
    for (const key of citekeys) {
      assert.notMatch(key, /^%%/, "citekey should not start with %%");
    }
  });

  it("should correctly parse almond1950 (single author, book)", function () {
    const e = entries.find((e) => e.citekey === "almond1950");
    assert.isDefined(e, "almond1950 should exist");
    assert.equal(e!.entryType, "book");
    assert.equal(e!.title, "The American People and Foreign Policy");
    assert.equal(e!.year, "1950");
    assert.deepEqual(e!.authors, ["Almond, Gabriel A."]);
    assert.isNull(e!.doi);
  });

  it("should correctly parse converse1964 (single author, article)", function () {
    const e = entries.find((e) => e.citekey === "converse1964");
    assert.isDefined(e);
    assert.equal(e!.entryType, "article");
    assert.equal(e!.title, "The Nature of Belief Systems in Mass Publics");
    assert.equal(e!.year, "1964");
    assert.deepEqual(e!.authors, ["Converse, Philip E."]);
    assert.equal(e!.fields["volume"], "18");
    assert.equal(e!.fields["pages"], "1--74");
  });

  it("should correctly parse pageShapiro1992 (two authors with and)", function () {
    const e = entries.find((e) => e.citekey === "pageShapiro1992");
    assert.isDefined(e);
    assert.deepEqual(e!.authors, ["Page, Benjamin I.", "Shapiro, Robert Y."]);
    assert.equal(
      e!.title,
      "The Rational Public: Fifty Years of Trends in Americans' Policy Preferences",
    );
  });

  it("should correctly parse campbellConverseMiller1960 (four authors)", function () {
    const e = entries.find((e) => e.citekey === "campbellConverseMiller1960");
    assert.isDefined(e);
    assert.lengthOf(e!.authors, 4);
    assert.equal(e!.authors[0], "Campbell, Angus");
    assert.equal(e!.authors[1], "Converse, Philip E.");
    assert.equal(e!.authors[2], "Miller, Warren E.");
    assert.equal(e!.authors[3], "Stokes, Donald E.");
  });

  it("should correctly parse gelpiFeaverReifler2006 (three authors)", function () {
    const e = entries.find((e) => e.citekey === "gelpiFeaverReifler2006");
    assert.isDefined(e);
    assert.lengthOf(e!.authors, 3);
    assert.equal(e!.authors[0], "Gelpi, Christopher");
    assert.equal(e!.authors[1], "Feaver, Peter D.");
    assert.equal(e!.authors[2], "Reifler, Jason");
    assert.equal(e!.year, "2006");
  });

  it("should strip LaTeX braces from berinsky2007 title", function () {
    const e = entries.find((e) => e.citekey === "berinsky2007");
    assert.isDefined(e);
    assert.equal(
      e!.title,
      "Assuming the Costs of War: Events, Elites, and American Public Support for Military Conflict",
    );
  });

  it("should strip LaTeX braces from berinsky2009 title (multiple brace groups)", function () {
    const e = entries.find((e) => e.citekey === "berinsky2009");
    assert.isDefined(e);
    assert.equal(
      e!.title,
      "In Time of War: Understanding American Public Opinion from World War II to Iraq",
    );
  });

  it("should handle possessive inside braces (melzer2009)", function () {
    const e = entries.find((e) => e.citekey === "melzer2009");
    assert.isDefined(e);
    assert.equal(e!.title, "Gun Crusaders: The NRA's Culture War");
  });

  it("should handle halbrook2013 (year field says 2008)", function () {
    const e = entries.find((e) => e.citekey === "halbrook2013");
    assert.isDefined(e);
    // The citekey says 2013 but the year field says 2008 — parser should use the field
    assert.equal(e!.year, "2008");
  });

  it("should handle parkerfixed2017 (five authors, month field)", function () {
    const e = entries.find((e) => e.citekey === "parkerfixed2017");
    assert.isDefined(e);
    assert.lengthOf(e!.authors, 5);
    assert.equal(e!.authors[0], "Parker, Kim");
    assert.equal(e!.year, "2017");
    assert.equal(e!.fields["month"], "June");
  });

  it("should handle smeltzDaadler2023 (five authors)", function () {
    const e = entries.find((e) => e.citekey === "smeltzDaadler2023");
    assert.isDefined(e);
    assert.lengthOf(e!.authors, 5);
    assert.equal(e!.authors[0], "Smeltz, Dina");
    assert.equal(e!.authors[4], "Sullivan, Emily");
  });

  it("should handle LaTeX escapes in gelmanStern2006 title", function () {
    const e = entries.find((e) => e.citekey === "gelmanStern2006");
    assert.isDefined(e);
    // Title has ``Significant'' and ``Not Significant'' with LaTeX double quotes
    assert.include(e!.title!, "Significant");
    assert.include(e!.title!, "Not Significant");
  });

  it("should handle hurwitzPeffley1987 title with {A}", function () {
    const e = entries.find((e) => e.citekey === "hurwitzPeffley1987");
    assert.isDefined(e);
    assert.equal(
      e!.title,
      "How Are Foreign Policy Attitudes Structured? A Hierarchical Model",
    );
  });

  it("should preserve rawBibtex for every entry", function () {
    for (const e of entries) {
      assert.isString(e.rawBibtex);
      assert.include(e.rawBibtex, `@${e.entryType}`);
      assert.include(e.rawBibtex, e.citekey);
    }
  });

  it("should have no entries with empty citekeys", function () {
    for (const e of entries) {
      assert.isNotEmpty(e.citekey, "citekey should not be empty");
    }
  });

  it("should have a title for every entry", function () {
    for (const e of entries) {
      assert.isNotNull(e.title, `${e.citekey} should have a title`);
      assert.isNotEmpty(e.title!, `${e.citekey} title should not be empty`);
    }
  });

  it("should have at least one author for every entry", function () {
    for (const e of entries) {
      assert.isAbove(
        e.authors.length,
        0,
        `${e.citekey} should have at least one author`,
      );
    }
  });

  it("should have a year for every entry", function () {
    for (const e of entries) {
      assert.isNotNull(e.year, `${e.citekey} should have a year`);
      assert.match(e.year!, /^\d{4}$/, `${e.citekey} year should be 4 digits`);
    }
  });
});
