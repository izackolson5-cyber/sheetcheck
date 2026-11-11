/* csv.js - dependency-free CSV parse/serialize. Works in browser (window.CSVLib) and node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSVLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function stripBOM(text) {
    if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
    return text;
  }

  // RFC4180-style parser: quoted fields, "" escapes, embedded newlines, CRLF/LF.
  function parse(text) {
    text = stripBOM(String(text == null ? '' : text));
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < n && text[i + 1] === '"') { field += '"'; i += 2; }
          else { inQuotes = false; i += 1; }
        } else { field += c; i += 1; }
      } else {
        if (c === '"') { inQuotes = true; i += 1; }
        else if (c === ',') { row.push(field); field = ''; i += 1; }
        else if (c === '\r') {
          if (i + 1 < n && text[i + 1] === '\n') i += 2; else i += 1;
          row.push(field); field = ''; rows.push(row); row = [];
        }
        else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i += 1; }
        else { field += c; i += 1; }
      }
    }
    if (inQuotes) {
      // Unterminated quote: keep what we have rather than losing the file.
      row.push(field); rows.push(row);
    } else if (field !== '' || row.length > 0) {
      row.push(field); rows.push(row);
    }
    // Drop trailing completely-empty rows
    while (rows.length && rows[rows.length - 1].every(function (v) { return v === ''; })) rows.pop();
    return rows;
  }

  function needsQuote(v) {
    return /[",\r\n]/.test(v);
  }

  function serialize(rows) {
    return rows.map(function (row) {
      return row.map(function (v) {
        v = v == null ? '' : String(v);
        if (needsQuote(v)) return '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(',');
    }).join('\r\n') + '\r\n';
  }

  // rows (array of arrays) -> array of objects keyed by header; keeps row numbers (1-based data rows, header = row 0)
  function toRecords(rows) {
    if (!rows.length) return { headers: [], records: [] };
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    var records = [];
    for (var i = 1; i < rows.length; i++) {
      var rec = { __row: i + 1 }; // spreadsheet row number (1-based, header is row 1)
      for (var j = 0; j < headers.length; j++) {
        rec[headers[j]] = rows[i][j] !== undefined ? rows[i][j] : '';
      }
      rec.__extra = rows[i].slice(headers.length); // cells beyond header width
      records.push(rec);
    }
    return { headers: headers, records: records };
  }

  function isBlankRow(rec, headers) {
    for (var j = 0; j < headers.length; j++) {
      if (String(rec[headers[j]] || '').trim() !== '') return false;
    }
    return true;
  }

  return { parse: parse, serialize: serialize, toRecords: toRecords, isBlankRow: isBlankRow };
});
