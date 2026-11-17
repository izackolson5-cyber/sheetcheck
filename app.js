/* app.js - UI glue for SheetCheck. All processing stays in the browser.
   Pro (unlock key) adds: saved supplier mappings and batch checking.
   Keys and presets live in this browser's local storage only - nothing is uploaded. */
(function () {
  'use strict';

  var supplierParsed = null;   // {headers, records} - single-file mode
  var exportParsed = null;     // {headers, records} | null
  var mapping = null;          // active mapping being edited {supplierHeader: shopifyKey|null}
  var lastResult = null;       // single mode: latest result
  var lastMapped = null;
  var currentFilter = 'all';

  // Batch mode (Pro): several supplier files against one shared export.
  var batchFiles = [];         // [{name, parsed, mapping, mapped, result}]
  var batchCurrent = 0;        // index of file whose mapping/issues are shown
  var batchRan = false;

  var proActive = false;

  var $ = function (id) { return document.getElementById(id); };

  function readFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () { cb(null, String(reader.result)); };
    reader.onerror = function () { cb(new Error('Could not read that file.')); };
    reader.readAsText(file);
  }

  function isBatch() { return batchFiles.length > 0; }

  // The parsed file whose mapping step 2 is currently editing.
  function mapSource() { return isBatch() ? batchFiles[batchCurrent].parsed : supplierParsed; }

  function refreshNextButton() {
    $('btn-to-mapping').disabled = !(supplierParsed || batchFiles.length);
  }

  function parseText(text) {
    var pw = CSVLib.parseWithWarnings(text);
    return CSVLib.toRecords(pw.rows, pw.warnings);
  }

  function loadCSV(file, which) {
    readFile(file, function (err, text) {
      if (err) { alert(err.message); return; }
      var parsed = parseText(text);
      if (!parsed.headers.length) { alert('That file looks empty.'); return; }
      var warnTxt = parsed.warnings.length ? ' - WARNING: ' + parsed.warnings[0] : '';
      if (which === 'supplier') {
        batchFiles = []; // a single file replaces any batch selection
        batchRan = false;
        $('fname-batch').textContent = '';
        supplierParsed = parsed;
        $('fname-supplier').textContent = file.name + ' - ' + parsed.records.length + ' rows, ' + parsed.headers.length + ' columns' + warnTxt;
      } else {
        exportParsed = parsed;
        $('fname-export').textContent = file.name + ' - ' + parsed.records.length + ' rows, ' + parsed.headers.length + ' columns' + warnTxt;
      }
      refreshNextButton();
    });
  }

  // ---- Pro: batch supplier files ----
  function loadBatch(files) {
    var list = [];
    for (var i = 0; i < files.length; i++) list.push(files[i]);
    if (!list.length) return;
    var done = 0, loaded = [], failed = [];
    list.forEach(function (f, idx) {
      readFile(f, function (err, text) {
        done++;
        if (err) { failed.push(f.name); }
        else {
          var parsed = parseText(text);
          if (!parsed.headers.length) failed.push(f.name + ' (empty)');
          else loaded.push({ name: f.name, parsed: parsed, mapping: null, mapped: null, result: null, order: idx });
        }
        if (done === list.length) {
          if (!loaded.length) { alert('None of those files could be read as CSVs.'); return; }
          loaded.sort(function (a, b) { return a.order - b.order; });
          loaded.forEach(function (bf) { bf.mapping = SheetChecker.autoMap(bf.parsed.headers); });
          batchFiles = loaded;
          batchCurrent = 0;
          batchRan = false;
          supplierParsed = null; // batch replaces the single supplier file
          $('fname-supplier').textContent = '';
          var names = loaded.map(function (b) { return b.name; });
          $('fname-batch').textContent = loaded.length + ' files: ' + names.join(', ') +
            (failed.length ? ' - could not read: ' + failed.join(', ') : '');
          refreshNextButton();
        }
      });
    });
  }

  function wireDropzone(dzId, inputId, which) {
    var dz = $(dzId), input = $(inputId);
    input.addEventListener('change', function () {
      if (which === 'batch') { if (input.files.length) loadBatch(input.files); }
      else if (input.files[0]) loadCSV(input.files[0], which);
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (which === 'batch') {
        if (e.dataTransfer.files && e.dataTransfer.files.length) loadBatch(e.dataTransfer.files);
      } else {
        var f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadCSV(f, which);
      }
    });
  }

  wireDropzone('dz-supplier', 'file-supplier', 'supplier');
  wireDropzone('dz-export', 'file-export', 'export');
  wireDropzone('dz-batch', 'file-batch', 'batch');

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
    batchFiles = [];
    batchRan = false;
    $('fname-batch').textContent = '';
    supplierParsed = CSVLib.toRecords(CSVLib.parse(supText));
    exportParsed = CSVLib.toRecords(CSVLib.parse(expText));
    $('fname-supplier').textContent = 'sample-supplier.csv - ' + supplierParsed.records.length + ' rows';
    $('fname-export').textContent = 'sample-shopify-export.csv - ' + exportParsed.records.length + ' rows';
    refreshNextButton();
    $('step2').classList.add('hidden');
    $('step3').classList.add('hidden');
  });

  // ---- Pro unlock ----
  function setPro(on, msg) {
    proActive = on;
    document.body.classList.toggle('pro', on);
    $('pro-badge').classList.toggle('hidden', !on);
    if (msg) $('pro-key-msg').textContent = msg;
  }
  try {
    var savedKey = localStorage.getItem(ProLib.KEY_STORE);
    if (savedKey && ProLib.validateKey(savedKey)) setPro(true, 'Pro is unlocked on this browser.');
  } catch (e) { /* storage unavailable - Pro still unlockable for this session via the form */ }
  $('btn-pro-unlock').addEventListener('click', function () {
    var k = $('pro-key-input').value;
    if (ProLib.validateKey(k)) {
      try { localStorage.setItem(ProLib.KEY_STORE, ProLib.normalizeKey(k)); } catch (e) {}
      setPro(true, 'Pro unlocked - batch check and saved mappings are on.');
    } else {
      $('pro-key-msg').textContent = 'That key does not look right - check the email it came in, or reply to that email for help.';
    }
  });

  // ---- Pro: saved supplier mappings ----
  var memStore = { _d: {}, getItem: function (k) { return this._d[k] || null; }, setItem: function (k, v) { this._d[k] = v; } };
  function store() {
    try { localStorage.setItem('__sc_probe', '1'); localStorage.removeItem('__sc_probe'); return localStorage; }
    catch (e) { return memStore; }
  }
  var presets = ProLib.loadPresets(store());

  function refreshPresetSelect() {
    var sel = $('preset-select');
    var names = Object.keys(presets).sort();
    sel.innerHTML = '<option value="">Saved mappings...</option>' + names.map(function (n) {
      return '<option value="' + escapeAttr(n) + '">' + escapeHtml(n) + '</option>';
    }).join('');
    $('btn-preset-delete').disabled = !names.length;
  }

  function currentMappingTarget() { return isBatch() ? batchFiles[batchCurrent] : null; }

  $('btn-preset-save').addEventListener('click', function () {
    if (!proActive || !mapping) return;
    var name = $('preset-name').value.trim();
    if (!name) { $('preset-msg').textContent = 'Name the supplier first, then save.'; return; }
    presets[name] = Object.assign({}, mapping);
    ProLib.savePresets(store(), presets);
    refreshPresetSelect();
    $('preset-msg').textContent = 'Saved "' + name + '". Next file from this supplier: pick it from the list.';
  });

  $('btn-preset-apply').addEventListener('click', function () {
    if (!proActive || !mapping) return;
    var name = $('preset-select').value;
    if (!name || !presets[name]) { $('preset-msg').textContent = 'Pick a saved mapping first.'; return; }
    var preset = presets[name];
    var headers = mapSource().headers;
    // Keep the auto-guess for columns the preset does not know; apply the preset where it does.
    headers.forEach(function (h) {
      if (Object.prototype.hasOwnProperty.call(preset, h)) mapping[h] = preset[h];
    });
    renderMapping();
    $('preset-msg').textContent = 'Applied "' + name + '". Columns new since you saved it keep their best guess - check them below.';
  });

  $('btn-preset-delete').addEventListener('click', function () {
    if (!proActive) return;
    var name = $('preset-select').value;
    if (!name || !presets[name]) return;
    delete presets[name];
    ProLib.savePresets(store(), presets);
    refreshPresetSelect();
    $('preset-msg').textContent = 'Deleted "' + name + '".';
  });

  // ---- Step 2: mapping ----
  $('btn-to-mapping').addEventListener('click', function () {
    if (isBatch()) {
      batchFiles.forEach(function (bf) { if (!bf.mapping) bf.mapping = SheetChecker.autoMap(bf.parsed.headers); });
      mapping = batchFiles[batchCurrent].mapping;
      rebuildBatchFileSelect();
      $('batch-mapper').classList.remove('hidden');
    } else {
      mapping = SheetChecker.autoMap(supplierParsed.headers);
      $('batch-mapper').classList.add('hidden');
    }
    refreshPresetSelect();
    renderMapping();
    $('step2').classList.remove('hidden');
    $('step2').scrollIntoView({ behavior: 'smooth' });
  });

  function rebuildBatchFileSelect() {
    var sel = $('batch-file-select');
    sel.innerHTML = batchFiles.map(function (bf, i) {
      return '<option value="' + i + '"' + (i === batchCurrent ? ' selected' : '') + '>' + escapeHtml(bf.name) + '</option>';
    }).join('');
  }

  $('batch-file-select').addEventListener('change', function () {
    batchCurrent = parseInt($('batch-file-select').value, 10) || 0;
    mapping = batchFiles[batchCurrent].mapping;
    renderMapping();
  });

  function renderMapping() {
    var src = mapSource();
    var opts = ['<option value="">(ignore this column)</option>'].concat(
      SheetChecker.SHOPIFY_FIELDS.map(function (f) {
        return '<option value="' + f.key + '">' + f.key + '</option>';
      })
    ).join('');
    var html = '<div class="table-scroll"><table><tr><th>Your column</th><th>Sample value</th><th>Maps to Shopify field</th></tr>';
    src.headers.forEach(function (h) {
      var sample = '';
      for (var i = 0; i < src.records.length; i++) {
        var v = String(src.records[i][h] || '').trim();
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
  // Block the run until the user resolves it explicitly. In batch mode, only the file
  // being edited is blocked - files with clean mappings can still run.
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
    var unmapped = mapSource().headers.filter(function (h) { return !mapping[h]; });
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
  function runOne(parsed, map, label) {
    var mapped = SheetChecker.applyMapping(parsed, map);
    var exportIndex = exportParsed ? SheetChecker.indexExport(exportParsed) : null;
    var result = SheetChecker.runChecks(mapped, exportIndex);
    (parsed.warnings || []).forEach(function (w) {
      result.issues.unshift({ severity: 'error', code: 'malformed-file', row: null, handle: '',
        message: 'Supplier file problem' + (label ? ' (' + label + ')' : '') + ': ' + w,
        detail: 'The results below may be incomplete because of this. Fix the file and run the check again.' });
    });
    var unmapped = parsed.headers.filter(function (h) { return !map[h]; });
    if (unmapped.length) {
      result.issues.push({ severity: 'info', code: 'unmapped-columns', row: null, handle: '',
        message: unmapped.length + ' supplier column(s) not carried into the cleaned file: ' + unmapped.join(', '),
        detail: 'Only columns mapped to a Shopify field appear in the cleaned import file. Go back to step 2 if one of these should be kept.' });
    }
    return { mapped: mapped, result: result, exportIndex: exportIndex };
  }

  $('btn-run').addEventListener('click', function () {
    if (mappingConflicts().length) { refreshMappingState(); return; }
    if (isBatch()) {
      batchFiles.forEach(function (bf) {
        var r = runOne(bf.parsed, bf.mapping, bf.name);
        bf.mapped = r.mapped;
        bf.result = r.result;
      });
      if (exportParsed) {
        (exportParsed.warnings || []).forEach(function (w) {
          batchFiles.forEach(function (bf) {
            bf.result.issues.unshift({ severity: 'error', code: 'malformed-export', row: null, handle: '',
              message: 'Shopify export problem: ' + w, detail: 'Comparison against your store may be incomplete because of this.' });
          });
        });
      }
      batchRan = true;
      renderBatchResults();
    } else {
      var r = runOne(supplierParsed, mapping, null);
      lastMapped = r.mapped;
      lastResult = r.result;
      if (exportParsed) {
        (exportParsed.warnings || []).forEach(function (w) {
          lastResult.issues.unshift({ severity: 'error', code: 'malformed-export', row: null, handle: '',
            message: 'Shopify export problem: ' + w, detail: 'Comparison against your store may be incomplete because of this.' });
        });
      }
      renderResults();
    }
    $('step3').classList.remove('hidden');
    $('step3').scrollIntoView({ behavior: 'smooth' });
  });

  function verdictFor(result, hasExport) {
    var s = result.stats;
    var errs = result.issues.filter(function (i) { return i.severity === 'error'; });
    var warns = result.issues.filter(function (i) { return i.severity === 'warning'; });
    var noExportNote = ' No Shopify export was provided, so the variant-deletion and price/stock-change checks did NOT run.';
    if (s.rows === 0) return { cls: 'bad', text: 'No data rows found - nothing was checked. Make sure the supplier file is a real CSV with a header row and at least one data row.' };
    if (errs.length) return { cls: 'bad', text: 'Do NOT import yet - ' + errs.length + ' error' + (errs.length > 1 ? 's' : '') + ' can lose or corrupt store data.' + (hasExport ? '' : noExportNote) };
    if (!hasExport) return { cls: 'warn', text: 'No data-destroying errors found INSIDE the supplier file - but without your Shopify export the two most important checks (variant-deletion risk and price/stock changes) did NOT run. Add the export in step 1 for the full check.' + (warns.length ? ' Also review the ' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') + ' below.' : '') };
    if (warns.length) return { cls: 'warn', text: 'No data-destroying errors, but review the ' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') + ' below before importing.' };
    return { cls: 'ok', text: 'Looks clean against your current export. Nothing dangerous found - still keep a backup export before importing.' };
  }

  // Safety gate shared by both modes: never offer an import file while
  // formula-injection cells exist or the supplier file parsed malformed.
  function gateFor(issues) {
    var formulaCount = issues.filter(function (i) { return i.code === 'formula-injection'; }).length;
    var decimalCommaCount = issues.filter(function (i) { return i.code === 'decimal-comma-price' || i.code === 'decimal-comma-qty'; }).length;
    var malformedCount = issues.filter(function (i) { return i.code === 'malformed-file'; }).length;
    if (!formulaCount && !malformedCount && !decimalCommaCount) return null;
    var parts = [];
    if (decimalCommaCount > 0) {
      parts.push(decimalCommaCount + ' value' + (decimalCommaCount > 1 ? 's look' : ' looks') +
        ' like decimal-comma number' + (decimalCommaCount > 1 ? 's' : '') + ' (e.g. "19,99") - fix them in the source file');
    }
    if (formulaCount > 0) {
      parts.push(formulaCount + ' cell' + (formulaCount > 1 ? 's' : '') + ' start' + (formulaCount > 1 ? '' : 's') +
        ' with a spreadsheet-formula character (=, +, @ or a non-numeric -)');
    }
    if (malformedCount > 0) {
      parts.push('the supplier file is malformed, so rows may be missing or merged and exporting it as clean output would be unsafe');
    }
    return parts.join('; and ');
  }

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
    $('stats').classList.remove('hidden');
    $('batch-summary').classList.add('hidden');
    $('issues-file-bar').classList.add('hidden');
    $('single-downloads').classList.remove('hidden');

    var v = verdictFor(lastResult, !!exportParsed);
    var vel = $('verdict');
    vel.className = v.cls;
    vel.textContent = v.text;

    var gate = gateFor(lastResult.issues);
    var fnote = $('formula-note');
    if (gate) {
      $('btn-download-clean').disabled = true;
      fnote.textContent = 'Cleaned-file download disabled: ' + gate + '. Fix the source file and run the check again.';
      fnote.classList.remove('hidden');
    } else {
      $('btn-download-clean').disabled = false;
      fnote.classList.add('hidden');
      fnote.textContent = '';
    }
    renderIssues(lastResult.issues);
  }

  // ---- Batch results (Pro) ----
  function renderBatchResults() {
    $('stats').classList.add('hidden');
    $('single-downloads').classList.add('hidden');
    $('issues-file-bar').classList.remove('hidden');
    var hasExport = !!exportParsed;

    var rowsHtml = batchFiles.map(function (bf, i) {
      var errs = bf.result.issues.filter(function (x) { return x.severity === 'error'; }).length;
      var warns = bf.result.issues.filter(function (x) { return x.severity === 'warning'; }).length;
      var v = verdictFor(bf.result, hasExport);
      var gated = gateFor(bf.result.issues);
      return '<tr>' +
        '<td>' + escapeHtml(bf.name) + '</td>' +
        '<td>' + bf.result.stats.rows + '</td>' +
        '<td class="' + (errs ? 'badcell' : '') + '">' + errs + '</td>' +
        '<td>' + warns + '</td>' +
        '<td>' + bf.result.stats.priceChanges + '</td>' +
        '<td><span class="pill ' + v.cls + '">' + (v.cls === 'bad' ? 'do not import' : v.cls === 'warn' ? 'review' : 'clean') + '</span></td>' +
        '<td><button class="btn ghost btn-sm" data-clean="' + i + '"' + (gated ? ' disabled title="Fix this file first - see its issues"' : '') + '>Cleaned CSV</button></td>' +
        '</tr>';
    }).join('');
    $('batch-summary').innerHTML = '<div class="table-scroll"><table><tr>' +
      '<th>File</th><th>Rows</th><th>Errors</th><th>Warnings</th><th>Price changes</th><th>Verdict</th><th></th>' +
      '</tr>' + rowsHtml + '</table></div>';
    $('batch-summary').classList.remove('hidden');
    Array.prototype.forEach.call($('batch-summary').querySelectorAll('[data-clean]'), function (btn) {
      btn.addEventListener('click', function () {
        downloadCleaned(batchFiles[parseInt(btn.getAttribute('data-clean'), 10)]);
      });
    });

    var totalErr = 0, filesWithErr = 0;
    batchFiles.forEach(function (bf) {
      var n = bf.result.issues.filter(function (x) { return x.severity === 'error'; }).length;
      totalErr += n;
      if (n) filesWithErr++;
    });
    var vel = $('verdict');
    if (filesWithErr) {
      vel.className = 'bad';
      vel.textContent = 'Do NOT import yet - ' + filesWithErr + ' of ' + batchFiles.length + ' files ' + (filesWithErr === 1 ? 'has' : 'have') + ' errors that can lose or corrupt store data (' + totalErr + ' error' + (totalErr === 1 ? '' : 's') + ' in total).';
    } else if (!hasExport) {
      vel.className = 'warn';
      vel.textContent = 'No data-destroying errors found INSIDE the supplier files - but without your Shopify export the variant-deletion and price/stock-change checks did NOT run. Add the export in step 1 for the full check.';
    } else {
      var totalWarn = 0;
      batchFiles.forEach(function (bf) { totalWarn += bf.result.issues.filter(function (x) { return x.severity === 'warning'; }).length; });
      if (totalWarn) {
        vel.className = 'warn';
        vel.textContent = 'No data-destroying errors in any file, but review the ' + totalWarn + ' warning' + (totalWarn > 1 ? 's' : '') + ' before importing.';
      } else {
        vel.className = 'ok';
        vel.textContent = 'All ' + batchFiles.length + ' files look clean against your current export. Nothing dangerous found - still keep a backup export before importing.';
      }
    }

    var sel = $('issues-file-select');
    sel.innerHTML = batchFiles.map(function (bf, i) {
      return '<option value="' + i + '"' + (i === batchCurrent ? ' selected' : '') + '>' + escapeHtml(bf.name) + '</option>';
    }).join('');
    renderIssues(batchFiles[batchCurrent].result.issues);
  }

  $('issues-file-select').addEventListener('change', function () {
    batchCurrent = parseInt($('issues-file-select').value, 10) || 0;
    renderIssues(batchFiles[batchCurrent].result.issues);
  });

  function stat(n, label) {
    return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + label + '</div></div>';
  }

  function renderIssues(issues) {
    var list = issues.filter(function (i) {
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
      if (isBatch() && batchRan) renderIssues(batchFiles[batchCurrent].result.issues);
      else if (lastResult) renderIssues(lastResult.issues);
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

  function downloadCleaned(bf) {
    var drop = {};
    if ($('chk-drop-errors').checked) {
      bf.result.issues.forEach(function (i) {
        if (i.severity === 'error' && i.row) drop[i.row] = true;
      });
    }
    var cleaned = SheetChecker.cleanRows(bf.mapped, drop);
    var rows = [bf.mapped.fields].concat(cleaned.map(function (r) {
      return bf.mapped.fields.map(function (f) { return r[f]; });
    }));
    var base = bf.name.replace(/\.csv$/i, '').replace(/[^a-z0-9_-]+/gi, '-');
    download(base + '.sheetcheck-cleaned.csv', CSVLib.serialize(rows));
  }

  $('btn-download-clean').addEventListener('click', function () {
    downloadCleaned({ name: 'sheetcheck', mapped: lastMapped, result: lastResult });
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

  $('btn-download-report-all').addEventListener('click', function () {
    var rows = [['File', 'Severity', 'Row', 'Handle', 'Issue', 'Detail']];
    batchFiles.forEach(function (bf) {
      bf.result.issues.forEach(function (i) {
        rows.push([bf.name, i.severity, i.row || '', i.handle, i.message, i.detail].map(sanitizeForSpreadsheet));
      });
    });
    download('sheetcheck-report-all.csv', CSVLib.serialize(rows));
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
