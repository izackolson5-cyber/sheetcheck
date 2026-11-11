/* checker.js - supplier-sheet vs Shopify-export checking logic.
   Pure functions; shared by the browser app and node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./csv.js'));
  } else {
    root.SheetChecker = factory(root.CSVLib);
  }
})(typeof self !== 'undefined' ? self : this, function (CSVLib) {
  'use strict';

  // Canonical Shopify product CSV fields we know how to check.
  var SHOPIFY_FIELDS = [
    { key: 'Handle', required: true, aliases: ['handle', 'url handle', 'slug', 'product handle'] },
    { key: 'Title', aliases: ['title', 'name', 'product name', 'product title', 'product', 'item name', 'description'] },
    { key: 'Body (HTML)', aliases: ['body', 'body html', 'body (html)', 'long description', 'details', 'product description'] },
    { key: 'Vendor', aliases: ['vendor', 'brand', 'manufacturer', 'supplier', 'make'] },
    { key: 'Product Category', aliases: ['product category', 'category'] },
    { key: 'Type', aliases: ['type', 'product type', 'product_type'] },
    { key: 'Tags', aliases: ['tags', 'tag', 'keywords'] },
    { key: 'Published', aliases: ['published', 'visible', 'visibility'] },
    { key: 'Option1 Name', aliases: ['option1 name', 'option 1 name', 'option name', 'option1', 'variant option 1 name'] },
    { key: 'Option1 Value', aliases: ['option1 value', 'option 1 value', 'option value', 'optionvalue', 'variant option 1', 'size', 'color', 'colour', 'option'] },
    { key: 'Option2 Name', aliases: ['option2 name', 'option 2 name'] },
    { key: 'Option2 Value', aliases: ['option2 value', 'option 2 value'] },
    { key: 'Option3 Name', aliases: ['option3 name', 'option 3 name'] },
    { key: 'Option3 Value', aliases: ['option3 value', 'option 3 value'] },
    { key: 'Variant SKU', aliases: ['sku', 'variant sku', 'code', 'item code', 'product code', 'part number', 'part no', 'mpn', 'item number', 'product id', 'item id'] },
    { key: 'Variant Grams', aliases: ['grams', 'weight grams', 'weight (g)'] },
    { key: 'Variant Inventory Tracker', aliases: ['inventory tracker', 'variant inventory tracker'] },
    { key: 'Variant Inventory Qty', aliases: ['qty', 'quantity', 'stock', 'inventory', 'inventory qty', 'stock qty', 'stock level', 'available', 'variant inventory qty', 'on hand'] },
    { key: 'Variant Inventory Policy', aliases: ['inventory policy', 'variant inventory policy', 'backorder'] },
    { key: 'Variant Fulfillment Service', aliases: ['fulfillment service', 'fulfilment service'] },
    { key: 'Variant Price', aliases: ['price', 'variant price', 'sell price', 'sale price', 'retail price', 'unit price', 'rrp', 'msrp', 'price (inc gst)', 'price ex', 'list price'] },
    { key: 'Variant Compare At Price', aliases: ['compare at price', 'compare price', 'was price', 'original price', 'variant compare at price'] },
    { key: 'Variant Requires Shipping', aliases: ['requires shipping'] },
    { key: 'Variant Taxable', aliases: ['taxable', 'charge tax'] },
    { key: 'Variant Barcode', aliases: ['barcode', 'upc', 'ean', 'gtin', 'isbn', 'variant barcode', 'ean13', 'upc code'] },
    { key: 'Image Src', aliases: ['image', 'image src', 'image url', 'photo', 'picture', 'img', 'image link', 'main image'] },
    { key: 'Status', aliases: ['status', 'state'] },
    { key: 'Cost per item', aliases: ['cost', 'cost per item', 'unit cost', 'buy price', 'wholesale price', 'cost price'] }
  ];

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[_\-\/\(\)\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Guess a mapping from supplier headers to Shopify fields.
  // Returns { supplierHeader: shopifyKey|null } plus list of unmapped headers.
  function autoMap(supplierHeaders) {
    var map = {};
    var usedShopify = {};
    supplierHeaders.forEach(function (h) {
      map[h] = null;
    });
    // Pass 1: exact alias match
    supplierHeaders.forEach(function (h) {
      var n = norm(h);
      for (var i = 0; i < SHOPIFY_FIELDS.length; i++) {
        var f = SHOPIFY_FIELDS[i];
        if (usedShopify[f.key]) continue;
        if (norm(f.key) === n || f.aliases.indexOf(n) !== -1) { map[h] = f.key; usedShopify[f.key] = true; return; }
      }
    });
    // Pass 2: substring match for still-unmapped headers
    supplierHeaders.forEach(function (h) {
      if (map[h]) return;
      var n = norm(h);
      if (!n) return;
      for (var i = 0; i < SHOPIFY_FIELDS.length; i++) {
        var f = SHOPIFY_FIELDS[i];
        if (usedShopify[f.key]) continue;
        var keys = [norm(f.key)].concat(f.aliases);
        for (var k = 0; k < keys.length; k++) {
          var a = keys[k];
          if (a.length >= 3 && (n.indexOf(a) !== -1 || a.indexOf(n) !== -1)) {
            map[h] = f.key; usedShopify[f.key] = true; return;
          }
        }
      }
    });
    return map;
  }

  function num(v) {
    if (v == null) return null;
    var s = String(v).replace(/[$£€¥,\s]/g, '').trim();
    if (s === '') return null;
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { invalid: String(v) };
    return parseFloat(s);
  }

  function truthyBad(v) {
    var s = norm(v);
    if (s === '') return false;
    return ['true', 'false', 'yes', 'no', '1', '0', 'y', 'n'].indexOf(s) === -1;
  }

  // Apply the mapping: produce canonical records from supplier records.
  // mapping: { supplierHeader: shopifyKey }
  function applyMapping(supplier, mapping) {
    var fields = [];
    Object.keys(mapping).forEach(function (h) {
      if (mapping[h] && fields.indexOf(mapping[h]) === -1) fields.push(mapping[h]);
    });
    var records = supplier.records.map(function (rec) {
      var out = { __row: rec.__row };
      fields.forEach(function (f) { out[f] = ''; });
      Object.keys(mapping).forEach(function (h) {
        var f = mapping[h];
        if (f) out[f] = rec[h] !== undefined ? rec[h] : '';
      });
      return out;
    });
    return { fields: fields, records: records };
  }

  // Index the current Shopify export by handle -> { record rows, optionNames, variants:[{sku, price, qty, title}] }
  function indexExport(exp) {
    var byHandle = {};
    exp.records.forEach(function (rec) {
      var h = String(rec['Handle'] || '').trim();
      if (!h) return;
      if (!byHandle[h]) byHandle[h] = { rows: [], title: '', options: [], variants: [] };
      var entry = byHandle[h];
      entry.rows.push(rec);
      if (!entry.title && String(rec['Title'] || '').trim()) entry.title = String(rec['Title']).trim();
      var combo = [];
      for (var i = 1; i <= 3; i++) {
        var name = String(rec['Option' + i + ' Name'] || '').trim();
        var val = String(rec['Option' + i + ' Value'] || '').trim();
        if (name && entry.options.indexOf(name) === -1) entry.options.push(name);
        if (name || val) combo.push((name ? name + ': ' : '') + val);
      }
      if (combo.length || String(rec['Variant SKU'] || '').trim() !== '' || String(rec['Variant Price'] || '').trim() !== '') {
        entry.variants.push({
          sku: String(rec['Variant SKU'] || '').trim(),
          price: String(rec['Variant Price'] || '').trim(),
          qty: String(rec['Variant Inventory Qty'] || '').trim(),
          option: combo.join(' / '), row: rec.__row
        });
      }
    });
    return byHandle;
  }

  // Main check run.
  // supplier: { fields, records } (already mapped to canonical keys)
  // exportIndex: result of indexExport, or null when no current export was provided.
  // Returns { issues: [...], stats: {...} }
  function runChecks(supplier, exportIndex) {
    var issues = [];
    var stats = { rows: supplier.records.length, newProducts: 0, existingProducts: 0, priceChanges: 0, qtyChanges: 0 };

    function add(sev, code, row, handle, msg, detail) {
      issues.push({ severity: sev, code: code, row: row, handle: handle || '', message: msg, detail: detail || '' });
    }

    var has = {};
    supplier.fields.forEach(function (f) { has[f] = true; });

    // Group supplier rows by handle, preserving order.
    var groups = [];
    var byHandle = {};
    supplier.records.forEach(function (rec) {
      var h = String(rec['Handle'] || '').trim();
      if (!h) {
        if (!CSVLib.isBlankRow(rec, supplier.fields.filter(function (f) { return f !== '__row'; }))) {
          add('error', 'missing-handle', rec.__row, '', 'Row has no Handle', 'Every product/variant row needs a Handle. Shopify groups variants by it.');
        }
        return;
      }
      if (!byHandle[h]) { byHandle[h] = { handle: h, rows: [] }; groups.push(byHandle[h]); }
      byHandle[h].rows.push(rec);
    });

    // Missing critical columns?
    if (!has['Handle']) {
      add('error', 'no-handle-column', null, '', 'No column is mapped to Handle', 'Map a column to Handle before importing; Shopify cannot group products without it.');
    }

    var seenSku = {}; // sku -> {row, handle}
    var newCount = 0, existCount = 0;

    groups.forEach(function (g) {
      var h = g.handle;
      var first = g.rows[0];
      var existing = exportIndex ? exportIndex[h] : null;
      if (existing) existCount++; else newCount++;

      // Title required on first row for new products
      var firstTitle = String(first['Title'] || '').trim();
      if (!firstTitle) {
        if (!existing) add('error', 'missing-title', first.__row, h, 'New product "' + h + '" has no Title on its first row', 'Shopify requires a Title to create a product.');
        else add('warning', 'missing-title-existing', first.__row, h, 'No Title on first row of existing product "' + h + '"', 'Blank Title on update can clear the product title in some import tools.');
      }

      // --- Variant deletion risk (Shopify's documented warning) ---
      // Existing product has options in the store, but the supplier rows for it lack option name/value columns or values.
      if (existing && existing.options.length > 0) {
        var optProblem = null;
        if (!has['Option1 Name'] && !has['Option1 Value']) {
          optProblem = 'The supplier file has no Option1 Name or Option1 Value column mapped at all.';
        } else {
          var anyOptVal = g.rows.some(function (r) { return String(r['Option1 Value'] || '').trim() !== ''; });
          if (!anyOptVal) optProblem = 'No Option1 Value is set on any row for this product.';
        }
        if (optProblem) {
          add('error', 'variant-deletion-risk', first.__row, h,
            'VARIANT DELETION RISK on "' + h + '"',
            'This product exists in your store with options (' + existing.options.join(', ') + '). ' + optProblem +
            ' Shopify\'s own docs warn that importing rows for an existing product with missing option columns can delete its variants. Fix the mapping or exclude this product.');
        }
      }

      // Options: value without name and vice versa
      g.rows.forEach(function (r) {
        for (var i = 1; i <= 3; i++) {
          var on = String(r['Option' + i + ' Name'] || '').trim();
          var ov = String(r['Option' + i + ' Value'] || '').trim();
          if (on && !ov) add('warning', 'option-name-no-value', r.__row, h, 'Option' + i + ' Name "' + on + '" has no value', 'Shopify may fail or create a malformed variant.');
          if (!on && ov) add('warning', 'option-value-no-name', r.__row, h, 'Option' + i + ' Value "' + ov + '" has no name', 'Shopify may fail or create a malformed variant.');
        }
      });

      // Duplicate variant option combo within the supplier file
      var combos = {};
      g.rows.forEach(function (r) {
        var combo = [1, 2, 3].map(function (i) { return String(r['Option' + i + ' Value'] || '').trim().toLowerCase(); }).join(' | ');
        var sku = String(r['Variant SKU'] || '').trim();
        var key = combo + ' :: ' + sku.toLowerCase();
        var looksVariantRow = combo.replace(/\|/g, '').trim() !== '' || sku !== '';
        if (looksVariantRow && g.rows.length > 1) {
          if (combos[key]) {
            add('error', 'duplicate-variant', r.__row, h, 'Duplicate variant row in supplier file', 'Same option values' + (sku ? ' and SKU "' + sku + '"' : '') + ' as row ' + combos[key] + '. Shopify import will reject or overwrite one of them.');
          } else combos[key] = r.__row;
        }
      });

      // Per-row field checks
      g.rows.forEach(function (r) {
        // SKU
        var sku = String(r['Variant SKU'] || '').trim();
        if (sku) {
          var skey = sku.toLowerCase();
          if (seenSku[skey] && seenSku[skey].handle !== h) {
            add('error', 'duplicate-sku', r.__row, h, 'SKU "' + sku + '" is used by two different products', 'Also on row ' + seenSku[skey].row + ' ("' + seenSku[skey].handle + '"). Duplicate SKUs break stock tracking and some imports.');
          } else if (!seenSku[skey]) seenSku[skey] = { row: r.__row, handle: h };
        } else if (g.rows.length > 1 || String(r['Variant Price'] || '').trim() !== '') {
          add('info', 'missing-sku', r.__row, h, 'Variant row has no SKU', 'Without SKUs, matching supplier updates to store variants later is guesswork.');
        }

        // Price
        var priceRaw = String(r['Variant Price'] || '').trim();
        if (priceRaw !== '') {
          var p = num(priceRaw);
          if (p && p.invalid) add('error', 'bad-price', r.__row, h, 'Price "' + priceRaw + '" is not a number', 'Shopify expects a plain number like 19.99. Check for text, currency words or formulas.');
          else if (p !== null && p < 0) add('error', 'negative-price', r.__row, h, 'Negative price ' + priceRaw, '');
        } else if (!existing) {
          add('warning', 'missing-price', r.__row, h, 'No price on new product row', 'Shopify will import it as 0.00.');
        }

        // Compare at
        var cmpRaw = String(r['Variant Compare At Price'] || '').trim();
        if (cmpRaw !== '') {
          var cp = num(cmpRaw);
          var pp = num(priceRaw);
          if (cp && cp.invalid) add('warning', 'bad-compare-price', r.__row, h, 'Compare-at price "' + cmpRaw + '" is not a number', '');
          else if (cp !== null && pp !== null && !pp.invalid && cp < pp) add('warning', 'compare-below-price', r.__row, h, 'Compare-at price ' + cmpRaw + ' is below the sell price ' + priceRaw, 'Shopify shows compare-at as the "was" price; below sell price looks wrong.');
        }

        // Barcode
        var bc = String(r['Variant Barcode'] || '').trim().replace(/\s/g, '');
        if (bc) {
          if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(bc)) {
            add('warning', 'bad-barcode', r.__row, h, 'Barcode "' + bc + '" is not a standard UPC/EAN/GTIN length', 'Expected 8, 12, 13 or 14 digits. Watch for Excel stripping leading zeros.');
          }
        }

        // Qty
        var qtyRaw = String(r['Variant Inventory Qty'] || '').trim();
        if (qtyRaw !== '') {
          var q = num(qtyRaw);
          if (q && q.invalid) add('error', 'bad-qty', r.__row, h, 'Inventory quantity "' + qtyRaw + '" is not a number', '');
          else if (q !== null && q < 0) add('warning', 'negative-qty', r.__row, h, 'Negative inventory quantity ' + qtyRaw, 'Usually means a stocktake or export problem upstream.');
        }

        // Booleans
        if (truthyBad(r['Variant Requires Shipping'])) add('warning', 'bad-bool', r.__row, h, 'Variant Requires Shipping has an unusual value "' + r['Variant Requires Shipping'] + '"', 'Use true/false.');
        if (truthyBad(r['Variant Taxable'])) add('warning', 'bad-bool', r.__row, h, 'Variant Taxable has an unusual value "' + r['Variant Taxable'] + '"', 'Use true/false.');

        // Status
        var st = norm(r['Status']);
        if (st && ['active', 'draft', 'archived'].indexOf(st) === -1) {
          add('warning', 'bad-status', r.__row, h, 'Status "' + r['Status'] + '" is not active, draft or archived', 'Shopify rejects other values.');
        }

        // Image
        var img = String(r['Image Src'] || '').trim();
        if (img && !/^https?:\/\//i.test(img)) add('warning', 'bad-image', r.__row, h, 'Image source "' + img.slice(0, 60) + '" is not an http(s) URL', 'Shopify can only fetch public URLs.');
      });

      // Compare against current export
      if (existing) {
        if (firstTitle && existing.title && norm(firstTitle) !== norm(existing.title)) {
          add('warning', 'title-change', first.__row, h, 'Title change: "' + existing.title + '" -> "' + firstTitle + '"', 'Import will rename the product in your store.');
        }
        // Match variants by SKU where possible
        existing.variants.forEach(function (ev) {
          if (!ev.sku) return;
          var match = null;
          g.rows.forEach(function (r) {
            if (String(r['Variant SKU'] || '').trim().toLowerCase() === ev.sku.toLowerCase()) match = r;
          });
          if (!match) {
            add('warning', 'variant-missing-from-import', ev.row, h, 'Store variant SKU "' + ev.sku + '" is not in the supplier file', 'Depending on import settings this variant can be deleted or left stale.');
            return;
          }
          var newP = num(match['Variant Price']);
          var oldP = num(ev.price);
          if (newP !== null && !newP.invalid && oldP !== null && !oldP.invalid && Math.abs(newP - oldP) > 0.0001) {
            var pct = oldP !== 0 ? ' (' + ((newP - oldP) / oldP * 100).toFixed(1) + '%)' : '';
            add('warning', 'price-change', match.__row, h, 'Price change on SKU "' + ev.sku + '": ' + oldP + ' -> ' + newP + pct, 'Check this is intended before importing.');
            stats.priceChanges++;
          }
          var newQ = num(match['Variant Inventory Qty']);
          var oldQ = num(ev.qty);
          if (newQ !== null && !newQ.invalid && oldQ !== null && !oldQ.invalid && newQ !== oldQ) {
            add('info', 'qty-change', match.__row, h, 'Stock change on SKU "' + ev.sku + '": ' + oldQ + ' -> ' + newQ, '');
            stats.qtyChanges++;
          }
        });
      } else if (exportIndex) {
        // New product: image recommended
        var hasImg = g.rows.some(function (r) { return String(r['Image Src'] || '').trim() !== ''; });
        if (!hasImg) add('info', 'no-image', first.__row, h, 'New product "' + h + '" has no image URL', 'Products without images convert worse; add an Image Src column when you can.');
      }
    });

    stats.newProducts = newCount;
    stats.existingProducts = existCount;

    // Sort: errors first, then warnings, then info; by row within.
    var sevRank = { error: 0, warning: 1, info: 2 };
    issues.sort(function (a, b) {
      if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
      return (a.row || 0) - (b.row || 0);
    });

    return { issues: issues, stats: stats };
  }

  // Auto-fix pass for the downloadable file: trim cells, normalize numbers, drop empty rows.
  function cleanRows(supplier, dropRows) {
    dropRows = dropRows || {};
    var out = [];
    supplier.records.forEach(function (rec) {
      if (dropRows[rec.__row]) return;
      var empty = true;
      var row = { __row: rec.__row };
      supplier.fields.forEach(function (f) {
        var v = String(rec[f] == null ? '' : rec[f]).trim();
        if (f === 'Variant Price' || f === 'Variant Compare At Price' || f === 'Cost per item') {
          var p = num(v);
          if (p !== null && !p.invalid) v = p.toFixed(2);
        }
        if (v !== '') empty = false;
        row[f] = v;
      });
      if (!empty) out.push(row);
    });
    return out;
  }

  return {
    SHOPIFY_FIELDS: SHOPIFY_FIELDS,
    autoMap: autoMap,
    applyMapping: applyMapping,
    indexExport: indexExport,
    runChecks: runChecks,
    cleanRows: cleanRows,
    norm: norm,
    num: num
  };
});
