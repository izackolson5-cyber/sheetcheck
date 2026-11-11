/* Adversarial tests for csv.js + checker.js. Run: node test/run-tests.js */
'use strict';
const CSV = require('../csv.js');
const SC = require('../checker.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}
function section(s) { console.log('\n== ' + s + ' =='); }

/* ---------- CSV parser ---------- */
section('CSV parser');

// 1. Basic round trip
{
  const rows = CSV.parse('a,b,c\n1,2,3\n');
  ok(rows.length === 2 && rows[1][2] === '3', 'basic parse');
  ok(CSV.parse(CSV.serialize(rows)).length === 2, 'basic round trip');
}

// 2. Quoted field with comma, double-quote escape, embedded newline
{
  const text = 'Handle,Body (HTML)\nprod-1,"<p>Hello, ""world""</p>\nLine two"\n';
  const rows = CSV.parse(text);
  ok(rows.length === 2, 'embedded newline keeps one record (got ' + rows.length + ')');
  ok(rows[1][1] === '<p>Hello, "world"</p>\nLine two', 'escaped quotes + comma inside quotes');
}

// 3. CRLF + BOM
{
  const rows = CSV.parse('﻿Handle,Title\r\na,B\r\nc,D\r\n');
  ok(rows.length === 3 && rows[0][0] === 'Handle', 'BOM + CRLF');
}

// 4. Unterminated quote doesn't lose the row
{
  const rows = CSV.parse('a,b\n1,"oops\n');
  ok(rows.length === 2 && rows[1][0] === '1', 'unterminated quote recovers');
}

// 5. Ragged rows (extra cells)
{
  const rows = CSV.parse('a,b\n1,2,3,4\n');
  const rec = CSV.toRecords(rows);
  ok(rec.records[0].__extra.length === 2, 'ragged extra cells captured');
}

// 6. Empty trailing lines dropped
{
  const rows = CSV.parse('a,b\n1,2\n\n\n');
  ok(rows.length === 2, 'trailing blanks dropped (got ' + rows.length + ')');
}

// 7. Field with only quotes
{
  const rows = CSV.parse('a,b\n"",x\n');
  ok(rows[1][0] === '' && rows[1][1] === 'x', 'empty quoted field');
}

/* ---------- Shopify-shaped export fixture ---------- */
const EXPORT_CSV = 'Handle,Title,Body (HTML),Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Variant Barcode,Image Src,Status\r\n' +
'leather-wallet,Leather Wallet,"<p>Handmade, <b>real</b> leather.</p>\n<ul><li>RFID</li></ul>",Acme,Size,Small,WL-S,120,50,deny,manual,29.99,39.99,true,true,0123456789012,https://cdn.example.com/w.jpg,active\r\n' +
'leather-wallet,,,,Size,Large,WL-L,125,30,deny,manual,34.99,,true,true,0123456789013,,active\r\n' +
'mug,Coffee Mug,"<p>Big mug</p>",Acme,,,MG-1,400,100,deny,manual,9.99,,true,true,,https://cdn.example.com/m.jpg,active\r\n';

function getExportIndex() {
  const parsed = CSV.toRecords(CSV.parse(EXPORT_CSV));
  ok(parsed.records.length === 3, 'export fixture has 3 records (got ' + parsed.records.length + ')');
  return SC.indexExport(parsed);
}

/* ---------- autoMap ---------- */
section('autoMap');
{
  const headers = ['Item Code', 'Product Name', 'RRP', 'QTY', 'EAN', 'Brand'];
  const map = SC.autoMap(headers);
  ok(map['Item Code'] === 'Variant SKU', 'Item Code -> SKU (got ' + map['Item Code'] + ')');
  ok(map['Product Name'] === 'Title', 'Product Name -> Title (got ' + map['Product Name'] + ')');
  ok(map['RRP'] === 'Variant Price', 'RRP -> Price (got ' + map['RRP'] + ')');
  ok(map['QTY'] === 'Variant Inventory Qty', 'QTY -> Qty (got ' + map['QTY'] + ')');
  ok(map['EAN'] === 'Variant Barcode', 'EAN -> Barcode (got ' + map['EAN'] + ')');
  ok(map['Brand'] === 'Vendor', 'Brand -> Vendor (got ' + map['Brand'] + ')');
}
{
  // No double-mapping: two price-ish headers -> only one wins
  const headers = ['Price', 'Wholesale Price'];
  const map = SC.autoMap(headers);
  ok(map['Price'] === 'Variant Price' && map['Wholesale Price'] === 'Cost per item',
    'price columns map distinctly (got ' + map['Price'] + ' / ' + map['Wholesale Price'] + ')');
}

/* ---------- runChecks ---------- */
section('runChecks: variant deletion risk (the big one)');
{
  // Supplier file updating existing product leather-wallet but with NO option columns
  const sup = CSV.toRecords(CSV.parse('Handle,Title,SKU,Price\nleather-wallet,Leather Wallet,WL-S,31.99\n'));
  const map = SC.autoMap(sup.headers);
  const mapped = SC.applyMapping(sup, map);
  const r = SC.runChecks(mapped, getExportIndex());
  const risk = r.issues.filter(i => i.code === 'variant-deletion-risk');
  ok(risk.length === 1 && risk[0].severity === 'error', 'missing option columns on existing product flagged as error');
  const pc = r.issues.filter(i => i.code === 'price-change');
  ok(pc.length === 1, 'price change 29.99 -> 31.99 detected');
}
{
  // Same but WITH option columns filled -> no deletion risk
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,SKU,Price\nleather-wallet,Leather Wallet,Size,Small,WL-S,31.99\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, getExportIndex());
  ok(r.issues.filter(i => i.code === 'variant-deletion-risk').length === 0, 'filled option columns clear the risk');
}
{
  // Options mapped but all values blank -> still risk
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,SKU,Price\nleather-wallet,Leather Wallet,Size,,WL-S,31.99\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, getExportIndex());
  ok(r.issues.filter(i => i.code === 'variant-deletion-risk').length === 1, 'blank option values still flagged');
}

section('runChecks: field validation');
{
  const sup = CSV.toRecords(CSV.parse([
    'Handle,Title,SKU,Price,Barcode,Qty,Status',
    'new-product,New Product,NP-1,abc,123,ten,live',          // bad price, bad barcode, bad qty, bad status
    ',No Handle Row,X-1,5.00,,1,active',                        // missing handle
    'other,Other,NP-1,5.00,,2,active',                          // duplicate SKU across handles
    'neg,Neg,NG-1,-4.00,,-3,draft'                              // negative price + qty
  ].join('\n')));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, getExportIndex());
  const codes = r.issues.map(i => i.code);
  ok(codes.includes('bad-price'), 'bad price caught');
  ok(codes.includes('bad-barcode'), 'bad barcode caught');
  ok(codes.includes('bad-qty'), 'bad qty caught');
  ok(codes.includes('bad-status'), 'bad status caught');
  ok(codes.includes('missing-handle'), 'missing handle caught');
  ok(codes.filter(c => c === 'duplicate-sku').length === 1, 'cross-product duplicate SKU caught once');
  ok(codes.includes('negative-price'), 'negative price caught');
  ok(codes.includes('negative-qty'), 'negative qty caught');
}
{
  // duplicate variant combo inside one product
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Value,SKU,Price\np,P,S,S1,5\np,,S,S1,6\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, null);
  ok(r.issues.filter(i => i.code === 'duplicate-variant').length === 1, 'duplicate variant combo caught');
}
{
  // clean file on existing store: no false errors
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,SKU,Price,Qty\nleather-wallet,Leather Wallet,Size,Small,WL-S,29.99,50\nleather-wallet,,Size,Large,WL-L,34.99,30\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, getExportIndex());
  const errs = r.issues.filter(i => i.severity === 'error');
  ok(errs.length === 0, 'clean matching file produces no errors (got: ' + JSON.stringify(errs.map(e => e.code)) + ')');
  ok(r.stats.existingProducts === 1 && r.stats.newProducts === 0, 'stats count existing products');
}
{
  // missing title on new product; price 0 warning
  const sup = CSV.toRecords(CSV.parse('Handle,SKU\nbrand-new,BN-1\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, getExportIndex());
  const codes = r.issues.map(i => i.code);
  ok(codes.includes('missing-title'), 'missing title on new product caught');
  ok(codes.includes('missing-price'), 'missing price on new product caught');
}

section('cleanRows');
{
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Price\n  spaced  , Trim Me , $19.9 \nx,Y,1,005\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const cleaned = SC.cleanRows(mapped, {});
  ok(cleaned[0].Handle === 'spaced' && cleaned[0]['Variant Price'] === '19.90', 'trims + normalizes price (got ' + cleaned[0]['Variant Price'] + ')');
  const dropped = SC.cleanRows(mapped, { 2: true });
  ok(dropped.length === 1 && dropped[0].__row === 3, 'dropRows removes chosen rows');
}

/* ---------- Big-file sanity ---------- */
section('scale sanity');
{
  let lines = ['Handle,Title,SKU,Price'];
  for (let i = 0; i < 20000; i++) lines.push('p' + i + ',"Title, ' + i + '",S' + i + ',' + (i % 97) + '.99');
  const t0 = Date.now();
  const sup = CSV.toRecords(CSV.parse(lines.join('\n')));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, null);
  const ms = Date.now() - t0;
  ok(sup.records.length === 20000 && ms < 5000, '20k rows parsed+checked in ' + ms + 'ms');
}

/* ---------- QA regression: formula injection ---------- */
section('formula injection');
{
  ok(SC.isFormulaCell('=HYPERLINK("http://x")'), '= detected');
  ok(SC.isFormulaCell('  \t+SUM(1,2)'), '+ after whitespace detected');
  ok(SC.isFormulaCell('@cmd'), '@ detected');
  ok(SC.isFormulaCell('-ABC'), 'non-numeric minus identifier detected');
  ok(!SC.isFormulaCell('-2.50'), 'numeric -2.50 NOT flagged');
  ok(!SC.isFormulaCell('-4'), 'integer -4 NOT flagged');
  ok(!SC.isFormulaCell('19.99'), 'plain number not flagged');
  ok(!SC.isFormulaCell(''), 'empty not flagged');
  const sup = CSV.toRecords(CSV.parse('Handle,Title,SKU,Price,Qty\nwidg,Widget,=HYPERLINK(http://evil.example),19.99,10\n'));
  const mapped = SC.applyMapping(sup, SC.autoMap(sup.headers));
  const r = SC.runChecks(mapped, null);
  const fi = r.issues.filter(i => i.code === 'formula-injection');
  ok(fi.length === 1 && fi[0].severity === 'error', 'formula cell becomes error issue (got ' + fi.length + ')');
  // negative price triggers negative-price but NOT formula-injection
  const sup2 = CSV.toRecords(CSV.parse('Handle,Title,SKU,Price\nneg,Neg,N1,-4.00\n'));
  const r2 = SC.runChecks(SC.applyMapping(sup2, SC.autoMap(sup2.headers)), null);
  ok(r2.issues.filter(i => i.code === 'formula-injection').length === 0, 'negative price not a formula issue');
  ok(r2.issues.filter(i => i.code === 'negative-price').length === 1, 'negative price still its own error');
  // cleanRows leaves import values verbatim (no apostrophe rewriting)
  const cleaned = SC.cleanRows(SC.applyMapping(sup, SC.autoMap(sup.headers)), {});
  ok(cleaned[0]['Variant SKU'] === '=HYPERLINK(http://evil.example)', 'cleaned import file keeps values verbatim');
}

/* ---------- QA regression: variant identity ---------- */
section('variant identity');
{
  // Store has Small/Large, supplier says S/M: both store variants at risk
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,Price\nleather-wallet,Leather Wallet,Size,S,31.99\nleather-wallet,,Size,M,36.99\n'));
  const r = SC.runChecks(SC.applyMapping(sup, SC.autoMap(sup.headers)), getExportIndex());
  const ow = r.issues.filter(i => i.code === 'variant-overwrite-risk');
  ok(ow.length === 2 && ow.every(i => i.severity === 'error'), 'both store variants flagged for overwrite risk (got ' + ow.length + ')');
  const nv = r.issues.filter(i => i.code === 'new-variant-option');
  ok(nv.length === 2, 'both supplier-only options flagged as new variants (got ' + nv.length + ')');
  // no double-reporting of the same variant
  ok(r.issues.filter(i => i.code === 'variant-missing-from-import').length === 0, 'no duplicate variant-missing warnings on top of overwrite errors');
}
{
  // Supplier covers only Small: Large at risk, Small fine
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,SKU,Price\nleather-wallet,Leather Wallet,Size,Small,WL-S,31.99\n'));
  const r = SC.runChecks(SC.applyMapping(sup, SC.autoMap(sup.headers)), getExportIndex());
  const ow = r.issues.filter(i => i.code === 'variant-overwrite-risk');
  ok(ow.length === 1 && ow[0].message.indexOf('large') !== -1, 'only the missing store variant flagged');
}
{
  // Matching option sets: no identity issues
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,SKU,Price\nleather-wallet,Leather Wallet,Size,Small,WL-S,29.99\nleather-wallet,,Size,Large,WL-L,34.99\n'));
  const r = SC.runChecks(SC.applyMapping(sup, SC.autoMap(sup.headers)), getExportIndex());
  ok(r.issues.filter(i => i.code === 'variant-overwrite-risk' || i.code === 'new-variant-option').length === 0, 'matching option sets produce no identity issues');
}
{
  // SKU-less store variant matched by option combo: price change still caught
  const exp = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Inventory Qty,Variant Price\r\nscarf,Wool Scarf,Color,Red,,12,20.00\r\n'));
  const idx = SC.indexExport(exp);
  const sup = CSV.toRecords(CSV.parse('Handle,Title,Option1 Name,Option1 Value,Price\nscarf,Wool Scarf,Color,Red,25.00\n'));
  const r = SC.runChecks(SC.applyMapping(sup, SC.autoMap(sup.headers)), idx);
  const pc = r.issues.filter(i => i.code === 'price-change');
  ok(pc.length === 1 && pc[0].message.indexOf('red') !== -1, 'SKU-less variant price change caught via option combo');
}

/* ---------- QA regression: malformed input never silent ---------- */
section('malformed input warnings');
{
  const pw = CSV.parseWithWarnings('a,b\n1,"oops\n2,3\n');
  ok(pw.warnings.length === 1 && pw.warnings[0].indexOf('malformed') !== -1, 'unterminated quote produces a warning');
  const rec = CSV.toRecords(pw.rows, pw.warnings);
  ok(rec.warnings.length === 1, 'warnings carried through toRecords');
}
{
  const rec = CSV.toRecords(CSV.parse('SKU,SKU,Price\nAAA,BBB,5.00\n'));
  ok(rec.warnings.length === 1 && rec.warnings[0].indexOf('more than once') !== -1, 'duplicate headers flagged');
  ok(rec.records[0]['SKU'] === 'AAA', 'duplicate headers first-wins, no silent collapse');
}
{
  const mapped = SC.applyMapping(CSV.toRecords(CSV.parse('Handle,Title,SKU,Price')), SC.autoMap(['Handle','Title','SKU','Price']));
  const r = SC.runChecks(mapped, null);
  ok(r.stats.rows === 0 && r.issues.length === 0, 'zero-row supplier: no crash, zero stats');
}

/* ---------- QA follow-up: defensive merge (first non-empty wins) ---------- */
section('defensive merge');
{
  const sup = CSV.toRecords(CSV.parse('SKU_A,SKU_B,Price\nAAA,BBB,5.00\n'));
  const mapped = SC.applyMapping(sup, { SKU_A: 'Variant SKU', SKU_B: 'Variant SKU', Price: 'Variant Price' });
  ok(mapped.records[0]['Variant SKU'] === 'AAA', 'duplicate field mapping: first non-empty wins (got ' + mapped.records[0]['Variant SKU'] + ')');
  const sup2 = CSV.toRecords(CSV.parse('SKU_A,SKU_B,Price\n,BBB,5.00\n'));
  const mapped2 = SC.applyMapping(sup2, { SKU_A: 'Variant SKU', SKU_B: 'Variant SKU', Price: 'Variant Price' });
  ok(mapped2.records[0]['Variant SKU'] === 'BBB', 'empty first column falls through to second');
}


section('Handle-less supplier files (real supplier shape)');

{
  const sup = CSV.toRecords(CSV.parse('Item Code,Product Name,RRP\nA-1,Widget,10.00\nA-1,Widget,10.00\nA-2,Gadget,abc\n'));
  const r = SC.runChecks(SC.applyMapping(sup, SC.autoMap(sup.headers)), null);
  const codes = r.issues.map(i => i.code);
  ok(codes.indexOf('no-handle-column') !== -1, 'handle column error still reported');
  ok(codes.indexOf('duplicate-sku') !== -1, 'dup SKU caught despite missing Handle');
  ok(codes.indexOf('bad-price') !== -1, 'bad price caught despite missing Handle');
}

section('Option column auto-mapping (Colour + Size supplier headers)');

{
  const map = SC.autoMap(['Item Code', 'Colour', 'Size']);
  ok(map['Colour'] === 'Option1 Value', 'Colour -> Option1 Value');
  ok(map['Size'] === 'Option2 Value', 'Size -> Option2 Value (not dropped)');
  const map2 = SC.autoMap(['Size']);
  ok(map2['Size'] === 'Option1 Value', 'single Size header still -> Option1 Value');
}

section('Decimal-comma prices');

{
  const sup = CSV.toRecords(CSV.parse('Handle,Variant Price\nh-1,"19,99"\nh-2,1,250.00\nh-3,29.99\n'));
  const r = SC.runChecks(SC.applyMapping(sup, SC.autoMap(sup.headers)), null);
  const dc = r.issues.filter(i => i.code === 'decimal-comma-price');
  ok(dc.length === 1 && dc[0].row === 2, '19,99 flagged once as possible decimal comma (got ' + dc.length + ')');
  ok(r.issues.filter(i => i.code === 'bad-price').length === 0, 'no false bad-price on comma values');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
