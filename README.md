# SheetCheck

Check a supplier spreadsheet against your Shopify product export **before** you import it.

Live tool: **https://izackolson5-cyber.github.io/sheetcheck/**

## Why

Shopify's own import docs warn that importing rows for an existing product with missing
option columns can **delete that product's variants**. SheetCheck catches that, plus:

- duplicate SKUs and duplicate variant rows
- broken prices, quantities, barcodes and status values
- every price and stock change versus your current store export
- missing titles, handles, images and SKUs

## Private by design

Everything runs in your browser. Files are never uploaded, no account, no tracking.

## Files

- `index.html` / `styles.css` / `app.js` - the app
- `csv.js` - dependency-free CSV parser (quoted fields, embedded newlines, BOM/CRLF)
- `checker.js` - column auto-mapping and all checks
- `test/run-tests.js` - adversarial test suite: `node test/run-tests.js`

Not affiliated with Shopify.
