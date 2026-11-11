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
      var parsed = CSVLib.toRecords(CSVLib.parse(text));
      if (!parsed.headers.length) { alert('That file looks empty.'); return; }
      if (which === 'supplier') {
        supplierParsed = parsed;
        $('fname-supplier').textContent = file.name + ' - ' + parsed.records.length + ' rows, ' + parsed.headers.length + ' columns';
      } else {
        exportParsed = parsed;
        $('fname-export').textContent = file.name + ' - ' + parsed.records.length + ' rows, ' + parsed.headers.length + ' columns';
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
    var html = '<table><tr><th>Your column</th><th>Sample value</th><th>Maps to Shopify field</th></tr>';
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
    html += '</table>';
    $('mapping-table').innerHTML = html;
    Array.prototype.forEach.call($('mapping-table').querySelectorAll('select'), function (sel) {
      var h = sel.getAttribute('data-header');
      if (mapping[h]) sel.value = mapping[h];
      sel.addEventListener('change', function () {
        mapping[h] = sel.value || null;
        sel.closest('tr').className = sel.value ? 'mapped-yes' : 'mapped-no';
      });
    });
  }

  // ---- Step 3: run ----
  $('btn-run').addEventListener('click', function () {
    lastMapped = SheetChecker.applyMapping(supplierParsed, mapping);
    var exportIndex = exportParsed ? SheetChecker.indexExport(exportParsed) : null;
    lastResult = SheetChecker.runChecks(lastMapped, exportIndex);
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
    if (errs.length) {
      v.className = 'bad';
      v.textContent = 'Do NOT import yet - ' + errs.length + ' error' + (errs.length > 1 ? 's' : '') + ' can lose or corrupt store data.';
    } else if (warns.length) {
      v.className = 'warn';
      v.textContent = 'No data-destroying errors, but review the ' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') + ' below before importing.';
    } else {
      v.className = 'ok';
      v.textContent = 'Looks clean. Nothing dangerous found - still keep a backup export before importing.';
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

  $('btn-download-report').addEventListener('click', function () {
    var rows = [['Severity', 'Row', 'Handle', 'Issue', 'Detail']].concat(
      lastResult.issues.map(function (i) { return [i.severity, i.row || '', i.handle, i.message, i.detail]; })
    );
    download('sheetcheck-report.csv', CSVLib.serialize(rows));
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
