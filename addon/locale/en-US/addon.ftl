startup-begin = Smart Import is loading
startup-finish = Smart Import is ready
import-summary-matched =
    { $count ->
        [one] { $count } existing item matched
       *[other] { $count } existing items matched
    }
import-summary-created =
    { $count ->
        [one] { $count } new item created
       *[other] { $count } new items created
    }
import-summary-ambiguous =
    { $count ->
        [one] { $count } ambiguous match (created as new)
       *[other] { $count } ambiguous matches (created as new)
    }
import-progress-parsing = Parsing .bib file...
import-progress-matching = Matching entries against library...
import-progress-importing = Importing new items...
import-error-no-entries = No entries found in .bib file
import-error-parse-failed = Failed to parse .bib file
import-error-import-failed = BibTeX import failed
