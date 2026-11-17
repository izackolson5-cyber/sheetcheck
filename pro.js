/* pro.js - SheetCheck Pro: unlock-key check and saved mapping presets.
   Works in the browser (window.ProLib) and in node (module.exports).

   Honest security note: the key check runs in the browser, so anyone reading
   this file can work out how to mint a key. It is a light lock that keeps
   honest buyers honest, not real access control - there is no server.
   Never describe it as more than that. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Unambiguous alphabet: no 0/O, 1/I.
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var KEY_STORE = 'sc_pro_key_v1';
  var PRESET_STORE = 'sc_presets_v1';

  function checksum(body) {
    var h = 7;
    for (var i = 0; i < body.length; i++) {
      var idx = ALPHABET.indexOf(body.charAt(i));
      if (idx < 0) return null;
      h = (h * 33 + idx * (i + 3)) % 1024;
    }
    return ALPHABET.charAt(h >> 5) + ALPHABET.charAt(h & 31);
  }

  function normalizeKey(key) {
    return String(key == null ? '' : key).toUpperCase().replace(/\s+/g, '');
  }

  function validateKey(key) {
    var k = normalizeKey(key);
    var m = /^SC1-([A-Z0-9]{6})-([A-Z0-9]{2})$/.exec(k);
    if (!m) return false;
    var c = checksum(m[1]);
    return c !== null && c === m[2];
  }

  // rng: function() -> [0,1). Used when issuing a key after a purchase.
  function makeKey(rng) {
    var r = rng || Math.random;
    var body = '';
    for (var i = 0; i < 6; i++) body += ALPHABET.charAt(Math.floor(r() * ALPHABET.length) % ALPHABET.length);
    return 'SC1-' + body + '-' + checksum(body);
  }

  // store: Storage-like {getItem, setItem}; anything thrown (private mode) means no presets.
  function loadPresets(store) {
    try {
      var raw = store.getItem(PRESET_STORE);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }

  function savePresets(store, presets) {
    try { store.setItem(PRESET_STORE, JSON.stringify(presets || {})); return true; }
    catch (e) { return false; }
  }

  return {
    KEY_STORE: KEY_STORE,
    PRESET_STORE: PRESET_STORE,
    validateKey: validateKey,
    normalizeKey: normalizeKey,
    makeKey: makeKey,
    loadPresets: loadPresets,
    savePresets: savePresets
  };
});
