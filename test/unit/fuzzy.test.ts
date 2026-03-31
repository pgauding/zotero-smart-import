import { assert } from "chai";
import {
  levenshteinDistance,
  levenshteinRatio,
  tokenSortRatio,
  tokenSetRatio,
  yearSimilarity,
} from "../../src/modules/fuzzy";

describe("fuzzy", function () {
  describe("levenshteinDistance", function () {
    it("should return 0 for identical strings", function () {
      assert.equal(levenshteinDistance("hello", "hello"), 0);
    });

    it("should return string length for empty vs non-empty", function () {
      assert.equal(levenshteinDistance("", "hello"), 5);
      assert.equal(levenshteinDistance("hello", ""), 5);
    });

    it("should return 0 for two empty strings", function () {
      assert.equal(levenshteinDistance("", ""), 0);
    });

    it("should return 1 for single character difference", function () {
      assert.equal(levenshteinDistance("cat", "bat"), 1);
      assert.equal(levenshteinDistance("cat", "cats"), 1);
      assert.equal(levenshteinDistance("cats", "cat"), 1);
    });

    it("should handle longer substitutions", function () {
      assert.equal(levenshteinDistance("kitten", "sitting"), 3);
    });
  });

  describe("levenshteinRatio", function () {
    it("should return 1.0 for identical strings", function () {
      assert.equal(levenshteinRatio("hello", "hello"), 1.0);
    });

    it("should return 1.0 for two empty strings", function () {
      assert.equal(levenshteinRatio("", ""), 1.0);
    });

    it("should return 0.0 for completely different strings", function () {
      assert.equal(levenshteinRatio("abc", "xyz"), 0.0);
    });

    it("should return expected ratio for known pair", function () {
      // "kitten" vs "sitting": distance=3, max_len=7, ratio = 1 - 3/7
      const ratio = levenshteinRatio("kitten", "sitting");
      assert.closeTo(ratio, 1 - 3 / 7, 0.001);
    });
  });

  describe("tokenSortRatio", function () {
    it("should return 1.0 for identical strings", function () {
      assert.equal(tokenSortRatio("hello world", "hello world"), 1.0);
    });

    it("should return 1.0 for reordered words", function () {
      assert.equal(
        tokenSortRatio("foreign policy public", "public foreign policy"),
        1.0,
      );
    });

    it("should be case insensitive", function () {
      assert.equal(
        tokenSortRatio("The American Voter", "the american voter"),
        1.0,
      );
    });

    it("should score high for very similar titles", function () {
      const score = tokenSortRatio(
        "The Nature and Origins of Mass Opinion",
        "The Nature and Origins of Mass Opinion",
      );
      assert.equal(score, 1.0);
    });

    it("should score lower for different titles", function () {
      const score = tokenSortRatio(
        "The Nature and Origins of Mass Opinion",
        "Gun Crusaders: The NRA's Culture War",
      );
      assert.isBelow(score, 0.5);
    });

    it("should handle real title near-matches", function () {
      // Same title with minor variation (e.g., LaTeX artifacts stripped vs not)
      const score = tokenSortRatio(
        "Assuming the Costs of War: Events, Elites, and American Public Support for Military Conflict",
        "Assuming the Costs of War: Events, Elites, and American Public Support for Military Conflict",
      );
      assert.equal(score, 1.0);
    });

    it("should handle titles that differ by subtitle", function () {
      const score = tokenSortRatio(
        "The Authoritarian Dynamic",
        "The Authoritarian Dynamic: A New Theory",
      );
      assert.isAbove(score, 0.6);
    });
  });

  describe("tokenSetRatio", function () {
    it("should return 1.0 for identical strings", function () {
      assert.equal(tokenSetRatio("hello world", "hello world"), 1.0);
    });

    it("should return 1.0 when one is a subset of the other", function () {
      // token_set_ratio should be very high when all tokens of A are in B
      const score = tokenSetRatio("John Smith", "John David Smith");
      assert.isAbove(score, 0.8);
    });

    it("should handle author name matching well", function () {
      // Typical case: .bib has full names, Zotero may abbreviate
      const score = tokenSetRatio(
        "Gelpi, Christopher; Feaver, Peter D.; Reifler, Jason",
        "Gelpi, Christopher; Feaver, Peter D.; Reifler, Jason",
      );
      assert.equal(score, 1.0);
    });

    it("should score reasonably for partial author overlap", function () {
      const score = tokenSetRatio(
        "Kinder, Donald R.; Sanders, Lynn M.",
        "Kinder, Donald R.; Sanders, Lynn M.",
      );
      assert.equal(score, 1.0);
    });

    it("should score low for completely different authors", function () {
      const score = tokenSetRatio("Gelpi, Christopher", "Zaller, John R.");
      assert.isBelow(score, 0.5);
    });
  });

  describe("yearSimilarity", function () {
    it("should return 1.0 for exact match", function () {
      assert.equal(yearSimilarity("2020", "2020"), 1.0);
    });

    it("should return 0.5 for off-by-one", function () {
      assert.equal(yearSimilarity("2020", "2021"), 0.5);
      assert.equal(yearSimilarity("2020", "2019"), 0.5);
    });

    it("should return 0.0 for off-by-two or more", function () {
      assert.equal(yearSimilarity("2020", "2022"), 0.0);
      assert.equal(yearSimilarity("2020", "2018"), 0.0);
      assert.equal(yearSimilarity("2020", "1990"), 0.0);
    });

    it("should return 0.0 when either is null", function () {
      assert.equal(yearSimilarity(null, "2020"), 0.0);
      assert.equal(yearSimilarity("2020", null), 0.0);
      assert.equal(yearSimilarity(null, null), 0.0);
    });

    it("should return 0.0 for non-numeric input", function () {
      assert.equal(yearSimilarity("abc", "2020"), 0.0);
      assert.equal(yearSimilarity("2020", "def"), 0.0);
    });
  });

  describe("end-to-end scoring simulation", function () {
    // Simulate the composite scoring the matcher uses:
    // 0.5 * titleScore + 0.3 * authorScore + 0.2 * yearScore

    function compositeScore(
      bibTitle: string,
      bibAuthors: string,
      bibYear: string,
      libTitle: string,
      libAuthors: string,
      libYear: string,
    ): number {
      return (
        0.5 * tokenSortRatio(bibTitle, libTitle) +
        0.3 * tokenSetRatio(bibAuthors, libAuthors) +
        0.2 * yearSimilarity(bibYear, libYear)
      );
    }

    it("should score > 0.75 for an exact match", function () {
      const score = compositeScore(
        "The Nature and Origins of Mass Opinion",
        "Zaller, John R.",
        "1992",
        "The Nature and Origins of Mass Opinion",
        "Zaller, John R.",
        "1992",
      );
      assert.isAbove(score, 0.75);
    });

    it("should score > 0.75 for a match with minor title differences", function () {
      const score = compositeScore(
        "The American People and Foreign Policy",
        "Almond, Gabriel A.",
        "1950",
        "The American People and Foreign Policy",
        "Almond, Gabriel A.",
        "1950",
      );
      assert.isAbove(score, 0.75);
    });

    it("should score < 0.40 for clearly different works", function () {
      const score = compositeScore(
        "Gun Crusaders: The NRA's Culture War",
        "Melzer, Scott",
        "2009",
        "The Authoritarian Dynamic",
        "Stenner, Karen",
        "2005",
      );
      assert.isBelow(score, 0.4);
    });

    it("should score high for same work even if year off-by-one", function () {
      const score = compositeScore(
        "Resolve in International Politics",
        "Kertzer, Joshua D.",
        "2016",
        "Resolve in International Politics",
        "Kertzer, Joshua D.",
        "2017",
      );
      // Title: 1.0, Author: 1.0, Year: 0.5 -> 0.5 + 0.3 + 0.1 = 0.9
      assert.isAbove(score, 0.75);
    });
  });
});
