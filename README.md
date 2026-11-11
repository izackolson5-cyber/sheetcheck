# SheetCheck

Check a supplier spreadsheet against your Shopify product export **before** you import it.

Live tool: **https://izackolson5-cyber.github.io/sheetcheck/**

## Why

Shopify's own import docs warn that importing rows for an existing product with missing
option columns can **delete that product's variants**. SheetCheck catches that, plus:

- variant-identity mismatches: store variants missing from the supplier file (overwrite risk),
  option renames that would create duplicate variants, and price/stock changes on variants
  with no SKU (matched by option combination)
- spreadsheet formula injection: cells starting with `=`, `+`, `@` (or a non-numeric `-`)
  are flagged as errors and block the cleaned-file download until fixed at the source.
  The cleaned import file is never rewritten - the diagnostic issue report is the
  separately sanitized, spreadsheet-safe export
- duplicate SKUs and duplicate variant rows
- broken prices, quantities, barcodes and status values
- every price and stock change versus your current store export
- missing titles, handles, images and SKUs
- malformed files (unterminated quotes, duplicate column names) are reported loudly,
  never swallowed

## Limits, on purpose

- Without your Shopify export, variant-deletion and price/stock-change checks cannot run.
  The tool says so on the verdict instead of claiming the file is clean.
- The cleaned file carries only the columns you mapped to Shopify fields; unmapped
  supplier columns are named in the results so nothing disappears silently.
- Passing checks is not a guarantee an import is safe. Always keep a backup export.

## Private by design

Everything runs in your browser. Files are never uploaded, no account, no tracking.

## Files

- `index.html` / `styles.css` / `app.js` - the app
- `csv.js` - dependency-free CSV parser (quoted fields, embedded newlines, BOM/CRLF, malformed-input warnings)
- `checker.js` - column auto-mapping and all checks
- `test/run-tests.js` - adversarial test suite (68 tests): `node test/run-tests.js`

Not affiliated with Shopify.
