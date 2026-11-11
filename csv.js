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
  function parseInternal(text, warnings) {
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
      // Unterminated quote: keep what we have rather than losing the file, but say so loudly.
      row.push(field); rows.push(row);
      if (warnings) warnings.push('The file ends inside a quoted value - the CSV is malformed. Rows after that point may be missing or merged. Re-export it from the source and check again.');
    } else if (field !== '' || row.length > 0) {
      row.push(field); rows.push(row);
    }
    // Drop trailing completely-empty rows
    while (rows.length && rows[rows.length - 1].every(function (v) { return v === ''; })) rows.pop();
    return rows;
  }

  function parse(text) { return parseInternal(text, null); }

  // Like parse, but also returns warnings about malformed input: { rows, warnings }
  function parseWithWarnings(text) {
    var warnings = [];
    var rows = parseInternal(text, warnings);
    return { rows: rows, warnings: warnings };
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
  // Optional parseWarnings (from parseWithWarnings) are carried through; duplicate header names are flagged and first-wins.
  function toRecords(rows, parseWarnings) {
    var warnings = (parseWarnings || []).slice();
    if (!rows.length) return { headers: [], records: [], warnings: warnings };
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    var seenH = {};
    var dupReported = {};
    headers.forEach(function (h) {
      if (seenH[h] && !dupReported[h]) {
        dupReported[h] = true;
        warnings.push('The column name "' + h + '" appears more than once. Only the first column\'s values are used - rename or remove the duplicate at the source.');
      }
      seenH[h] = true;
    });
    var records = [];
    for (var i = 1; i < rows.length; i++) {
      var rec = { __row: i + 1 }; // spreadsheet row number (1-based, header is row 1)
      for (var j = 0; j < headers.length; j++) {
        if (rec[headers[j]] === undefined) rec[headers[j]] = rows[i][j] !== undefined ? rows[i][j] : '';
      }
      rec.__extra = rows[i].slice(headers.length); // cells beyond header width
      records.push(rec);
    }
    return { headers: headers, records: records, warnings: warnings };
  }

  function isBlankRow(rec, headers) {
    for (var j = 0; j < headers.length; j++) {
      if (String(rec[headers[j]] || '').trim() !== '') return false;
    }
    return true;
  }

  return { parse: parse, parseWithWarnings: parseWithWarnings, serialize: serialize, toRecords: toRecords, isBlankRow: isBlankRow };
});
