/* app.js - UI glue for SheetCheck. All processing stays in the browser. */
(function () {
  'use strict';

  var supplierParsed = null;   // {headers, records}
  var exportParsed = null;     // {headers, records} | null
  var mapping = null;          // {supplierHeader: shopifyKey|null}
  var lastResult = null;
  var lastMapped = null;
  var currentFilter = 'all';

  var $ = function (id) { return document.getElementById(id); };

  function readFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () { cb(null, String(reader.result)); };
    reader.onerror = function () { cb(new Error('Could not read that file.')); };
    reader.readAsText(file);
  }

  function loadCSV(file, which) {
    readFile(file, function (err, text) {
      if (err) { alert(err.message); return; }
      var pw = CSVLib.parseWithWarnings(text);
      var parsed = CSVLib.toRecords(pw.rows, pw.warnings);
      if (!parsed.headers.length) { alert('That file looks empty.'); return; }
      var warnTxt = parsed.warnings.length ? ' - WARNING: ' + parsed.warnings[0] : '';
      if (which === 'supplier') {
        supplierParsed = parsed;
        $('fname-supplier').textContent = file.name + ' - ' + parsed.records.length + ' rows, ' + parsed.headers.length + ' columns' + warnTxt;
      } else {
        exportParsed = parsed;
        $('fname-export').textContent = file.name + ' - ' + parsed.records.length + ' rows, ' + parsed.headers.length + ' columns' + warnTxt;
      }
      $('btn-to-mapping').disabled = !supplierParsed;
    });
  }

  function wireDropzone(dzId, inputId, which) {
    var dz = $(dzId), input = $(inputId);
    input.addEventListener('change', function () {
      if (input.files[0]) loadCSV(input.files[0], which);
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadCSV(f, which);
    });
  }

  wireDropzone('dz-supplier', 'file-supplier', 'supplier');
  wireDropzone('dz-export', 'file-export', 'export');

  // ---- Sample data ----
  $('btn-sample').addEventListener('click', function () {
    var supText = [
      'Handle,Item Code,Product Name,RRP,QTY,EAN,Brand',
      'leather-wallet,WL-S,Leather Wallet,31.99,60,0123456789012,Acme',
      'leather-wallet,WL-L,Leather Wallet,36.99,25,0123456789013,Acme',
      'mug,MG-1,Coffee Mug,11.50,90,,Acme',
      'bamboo-notebook,NEW-1,Bamboo Notebook,7.50,200,123,Acme',
      'other-product,WL-S,Wallet restock,32.99,5,,Acme'
    ].join('\n');
    var expText = 'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Inventory Qty,Variant Price,Variant Barcode,Image Src,Status\r\n' +
      'leather-wallet,Leather Wallet,Size,Small,WL-S,50,29.99,0123456789012,https://example.com/w.jpg,active\r\n' +
      'leather-wallet,,Size,Large,WL-L,30,34.99,0123456789013,,active\r\n' +
      'mug,Coffee Mug,,,MG-1,100,9.99,,https://example.com/m.jpg,active\r\n';
    // The sample supplier file has no Option columns: SheetCheck will show
    // the variant-deletion risk on leather-wallet, price changes, a duplicate SKU and a bad barcode.
    supplierParsed = CSVLib.toRecords(CSVLib.parse(supText));
    exportParsed = CSVLib.toRecords(CSVLib.parse(expText));
    $('fname-supplier').textContent = 'sample-supplier.csv - ' + supplierParsed.records.length + ' rows';
    $('fname-export').textContent = 'sample-shopify-export.csv - ' + exportParsed.records.length + ' rows';
    $('btn-to-mapping').disabled = false;
    $('step2').classList.add('hidden');
    $('step3').classList.add('hidden');
  });

  // ---- Step 2: mapping ----
  $('btn-to-mapping').addEventListener('click', function () {
    mapping = SheetChecker.autoMap(supplierParsed.headers);
    renderMapping();
    $('step2').classList.remove('hidden');
    $('step2').scrollIntoView({ behavior: 'smooth' });
  });

  function renderMapping() {
    var opts = ['<option value="">(ignore this column)</option>'].concat(
      SheetChecker.SHOPIFY_FIELDS.map(function (f) {
        return '<option value="' + f.key + '">' + f.key + '</option>';
      })
    ).join('');
    var html = '<div class="table-scroll"><table><tr><th>Your column</th><th>Sample value</th><th>Maps to Shopify field</th></tr>';
    supplierParsed.headers.forEach(function (h) {
      var sample = '';
      for (var i = 0; i < supplierParsed.records.length; i++) {
        var v = String(supplierParsed.records[i][h] || '').trim();
        if (v) { sample = v.slice(0, 40); break; }
      }
      var sel = '<select data-header="' + escapeAttr(h) + '">' + opts + '</select>';
      var cls = mapping[h] ? 'mapped-yes' : 'mapped-no';
      html += '<tr class="' + cls + '"><td>' + escapeHtml(h) + '</td><td>' + escapeHtml(sample) + '</td><td>' + sel + '</td></tr>';
    });
    html += '</table></div>' +
      '<p class="scroll-hint">Tip: the table is wider than your screen - swipe it sideways to reach the "Maps to Shopify field" dropdowns.</p>';
    $('mapping-table').innerHTML = html;
    Array.prototype.forEach.call($('mapping-table').querySelectorAll('select'), function (sel) {
      var h = sel.getAttribute('data-header');
      if (mapping[h]) sel.value = mapping[h];
      sel.addEventListener('change', function () {
        mapping[h] = sel.value || null;
        sel.closest('tr').className = sel.value ? 'mapped-yes' : 'mapped-no';
        refreshMappingState();
      });
    });
    refreshMappingState();
  }

  // Two columns mapped to the same Shopify field would silently overwrite each other.
  // Block the run until the user resolves it explicitly.
  function mappingConflicts() {
    var byField = {};
    Object.keys(mapping).forEach(function (h) {
      var f = mapping[h];
      if (!f) return;
      if (byField[f]) byField[f].push(h); else byField[f] = [h];
    });
    var out = [];
    Object.keys(byField).forEach(function (f) {
      if (byField[f].length > 1) out.push({ field: f, headers: byField[f] });
    });
    return out;
  }

  function refreshMappingState() {
    var conflicts = mappingConflicts();
    var box = $('mapping-conflict');
    if (conflicts.length) {
      box.innerHTML = conflicts.map(function (c) {
        var names = c.headers.map(escapeHtml).join('</strong> and <strong>');
        return 'Columns <strong>' + names + '</strong> both map to <strong>' +
          escapeHtml(c.field) + '</strong> - only one would be used and the other\'s data would be silently lost. ' +
          'Change one of them to "(ignore this column)" or a different field.';
      }).join('<br>');
      box.classList.remove('hidden');
      $('btn-run').disabled = true;
    } else {
      box.classList.add('hidden');
      box.innerHTML = '';
      $('btn-run').disabled = false;
    }
    var unmapped = supplierParsed.headers.filter(function (h) { return !mapping[h]; });
    var note = $('unmapped-note');
    if (unmapped.length) {
      note.textContent = 'Not carried into the cleaned file (no Shopify field): ' + unmapped.join(', ') +
        '. If one of these matters - for example a second SKU or code column - map it above instead.';
      note.classList.remove('hidden');
    } else {
      note.classList.add('hidden');
      note.textContent = '';
    }
  }

  // ---- Step 3: run ----
  $('btn-run').addEventListener('click', function () {
    if (mappingConflicts().length) { refreshMappingState(); return; }
    lastMapped = SheetChecker.applyMapping(supplierParsed, mapping);
    var exportIndex = exportParsed ? SheetChecker.indexExport(exportParsed) : null;
    lastResult = SheetChecker.runChecks(lastMapped, exportIndex);
    // Malformed input is never silent: surface parse problems as loud issues.
    (supplierParsed.warnings || []).forEach(function (w) {
      lastResult.issues.unshift({ severity: 'error', code: 'malformed-file', row: null, handle: '',
        message: 'Supplier file problem: ' + w, detail: 'The results below may be incomplete because of this. Fix the file and run the check again.' });
    });
    if (exportParsed) {
      (exportParsed.warnings || []).forEach(function (w) {
        lastResult.issues.unshift({ severity: 'error', code: 'malformed-export', row: null, handle: '',
          message: 'Shopify export problem: ' + w, detail: 'Comparison against your store may be incomplete because of this.' });
      });
    }
    // Disclose exactly which supplier columns are dropped from the cleaned file.
    var unmapped = supplierParsed.headers.filter(function (h) { return !mapping[h]; });
    if (unmapped.length) {
      lastResult.issues.push({ severity: 'info', code: 'unmapped-columns', row: null, handle: '',
        message: unmapped.length + ' supplier column(s) not carried into the cleaned file: ' + unmapped.join(', '),
        detail: 'Only columns mapped to a Shopify field appear in the cleaned import file. Go back to step 2 if one of these should be kept.' });
    }
    renderResults();
    $('step3').classList.remove('hidden');
    $('step3').scrollIntoView({ behavior: 'smooth' });
  });

  function renderResults() {
    var s = lastResult.stats;
    var errs = lastResult.issues.filter(function (i) { return i.severity === 'error'; });
    var warns = lastResult.issues.filter(function (i) { return i.severity === 'warning'; });

    $('stats').innerHTML =
      stat(s.rows, 'rows checked') +
      stat(s.newProducts, 'new products') +
      stat(s.existingProducts, 'existing products') +
      stat(errs.length, 'errors') +
      stat(warns.length, 'warnings') +
      stat(s.priceChanges, 'price changes');

    var v = $('verdict');
    var noExport = !exportParsed;
    var noExportNote = ' No Shopify export was provided, so the variant-deletion and price/stock-change checks did NOT run.';
    if (s.rows === 0) {
      v.className = 'bad';
      v.textContent = 'No data rows found - nothing was checked. Make sure the supplier file is a real CSV with a header row and at least one data row.';
    } else if (errs.length) {
      v.className = 'bad';
      v.textContent = 'Do NOT import yet - ' + errs.length + ' error' + (errs.length > 1 ? 's' : '') + ' can lose or corrupt store data.' + (noExport ? noExportNote : '');
    } else if (noExport) {
      v.className = 'warn';
      v.textContent = 'No data-destroying errors found INSIDE the supplier file - but without your Shopify export the two most important checks (variant-deletion risk and price/stock changes) did NOT run. Add the export in step 1 for the full check.' +
        (warns.length ? ' Also review the ' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') + ' below.' : '');
    } else if (warns.length) {
      v.className = 'warn';
      v.textContent = 'No data-destroying errors, but review the ' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') + ' below before importing.';
    } else {
      v.className = 'ok';
      v.textContent = 'Looks clean against your current export. Nothing dangerous found - still keep a backup export before importing.';
    }
    // Safety gate: never offer an import file while formula-injection cells exist or the
    // supplier file parsed malformed (rows may be missing or merged). Dropping or repairing
    // rows automatically could break per-handle variant structure or export partial data as
    // if it were clean, so the download stays disabled until the source file is fixed.
    var formulaCount = lastResult.issues.filter(function (i) { return i.code === 'formula-injection'; }).length;
    var malformedCount = lastResult.issues.filter(function (i) { return i.code === 'malformed-file'; }).length;
    var fnote = $('formula-note');
    if (formulaCount > 0 || malformedCount > 0) {
      $('btn-download-clean').disabled = true;
      var parts = [];
      if (formulaCount > 0) {
        parts.push(formulaCount + ' cell' + (formulaCount > 1 ? 's' : '') + ' start' + (formulaCount > 1 ? '' : 's') +
          ' with a spreadsheet-formula character (=, +, @ or a non-numeric -)');
      }
      if (malformedCount > 0) {
        parts.push('the supplier file is malformed, so rows may be missing or merged and exporting it as clean output would be unsafe');
      }
      fnote.textContent = 'Cleaned-file download disabled: ' + parts.join('; and ') +
        '. Fix the source file and run the check again.';
      fnote.classList.remove('hidden');
    } else {
      $('btn-download-clean').disabled = false;
      fnote.classList.add('hidden');
      fnote.textContent = '';
    }
    renderIssues();
  }

  function stat(n, label) {
    return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + label + '</div></div>';
  }

  function renderIssues() {
    var list = lastResult.issues.filter(function (i) {
      return currentFilter === 'all' || i.severity === currentFilter;
    });
    if (!list.length) {
      $('issues').innerHTML = '<p class="fineprint">No issues in this view.</p>';
      return;
    }
    $('issues').innerHTML = list.map(function (i) {
      var loc = [];
      if (i.row) loc.push('row ' + i.row);
      if (i.handle) loc.push(i.handle);
      return '<div class="issue ' + i.severity + '">' +
        '<span class="sev">' + i.severity + '</span>' +
        '<span class="loc">' + escapeHtml(loc.join(' - ')) + '</span>' +
        '<div><strong>' + escapeHtml(i.message) + '</strong>' +
        (i.detail ? '<span class="detail">' + escapeHtml(i.detail) + '</span>' : '') +
        '</div></div>';
    }).join('');
  }

  Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'), function (chip) {
    chip.addEventListener('click', function () {
      currentFilter = chip.getAttribute('data-sev');
      Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'), function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      renderIssues();
    });
  });

  // ---- Downloads ----
  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('btn-download-clean').addEventListener('click', function () {
    var drop = {};
    if ($('chk-drop-errors').checked) {
      lastResult.issues.forEach(function (i) {
        if (i.severity === 'error' && i.row) drop[i.row] = true;
      });
    }
    var cleaned = SheetChecker.cleanRows(lastMapped, drop);
    var rows = [lastMapped.fields].concat(cleaned.map(function (r) {
      return lastMapped.fields.map(function (f) { return r[f]; });
    }));
    download('sheetcheck-cleaned.csv', CSVLib.serialize(rows));
  });

  // Diagnostic issue report: safe to open in Excel/Sheets - formula-leading cells are quoted.
  // (The cleaned import file is deliberately left verbatim so Shopify values are never rewritten.)
  function sanitizeForSpreadsheet(v) {
    var s = String(v == null ? '' : v);
    if (/^\s*[=+\-@]/.test(s)) return "'" + s;
    return s;
  }

  $('btn-download-report').addEventListener('click', function () {
    var rows = [['Severity', 'Row', 'Handle', 'Issue', 'Detail']].concat(
      lastResult.issues.map(function (i) {
        return [i.severity, i.row || '', i.handle, i.message, i.detail].map(sanitizeForSpreadsheet);
      })
    );
    download('sheetcheck-report.csv', CSVLib.serialize(rows));
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
