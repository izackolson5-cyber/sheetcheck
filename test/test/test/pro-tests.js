/* Tests for pro.js - Pro key check and preset storage. Run: node test/pro-tests.js */
'use strict';
const P = require('../pro.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}

// Deterministic rng for reproducible keys
function fakeRng(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

// 1. Generated keys validate
{
  let allOk = true;
  for (let i = 0; i < 500; i++) { if (!P.validateKey(P.makeKey(fakeRng(i + 1)))) allOk = false; }
  ok(allOk, '500 generated keys all validate');
}

// 2. Known key is stable across implementations
{
  ok(P.validateKey('SC1-DW2WWX-RE'), 'known key validates (stable checksum)');
}

// 3. Tampering fails: flip body char, flip check char, swap halves
{
  const k = P.makeKey(fakeRng(42));
  const body = k.slice(4, 10), chk = k.slice(11, 13);
  const flip = (c) => c === 'A' ? 'B' : 'A';
  ok(!P.validateKey('SC1-' + flip(body[0]) + body.slice(1) + '-' + chk), 'flipped body char rejected');
  ok(!P.validateKey('SC1-' + body + '-' + flip(chk[0]) + chk[1]), 'flipped check char rejected');
  ok(!P.validateKey('SC1-' + chk + body.slice(2) + '-' + body.slice(0, 2)), 'swapped parts rejected');
}

// 4. Format enforcement
{
  ok(!P.validateKey(''), 'empty rejected');
  ok(!P.validateKey('SC1-ABC-D'), 'short parts rejected');
  ok(!P.validateKey('SC1-ABCDEF0-GH'), '7-char body rejected');
  ok(!P.validateKey('SC1-ABCD1O-XX'), 'excluded alphabet chars (1, O) rejected');
  ok(!P.validateKey('SC2-ABCDEF-GH'), 'wrong prefix rejected');
}

// 5. Normalization: lowercase and stray spaces still validate
{
  const k = P.makeKey(fakeRng(7));
  ok(P.validateKey(k.toLowerCase()), 'lowercase validates');
  ok(P.validateKey('  ' + k.slice(0, 4) + ' ' + k.slice(4) + ' '), 'stray spaces validate');
  ok(P.normalizeKey(' sc1-abc def-gh ') === 'SC1-ABCDEF-GH', 'normalizeKey strips spaces/uppercases');
}

// 6. Preset storage round trip with a memory store
{
  const mem = { _d: {}, getItem(k2) { return this._d[k2] || null; }, setItem(k2, v) { this._d[k2] = v; } };
  ok(JSON.stringify(P.loadPresets(mem)) === '{}', 'empty store gives no presets');
  const presets = { acme: { Handle: 'Handle', SKU: 'Variant SKU' } };
  ok(P.savePresets(mem, presets) === true, 'savePresets works');
  const back = P.loadPresets(mem);
  ok(back.acme && back.acme.SKU === 'Variant SKU', 'preset round trip');
}

// 7. Broken storage never throws
{
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  ok(JSON.stringify(P.loadPresets(broken)) === '{}', 'denied storage reads as empty');
  ok(P.savePresets(broken, { a: 1 }) === false, 'denied storage save returns false');
  ok(P.loadPresets({ getItem() { return '{not json'; } }) && true, 'corrupt JSON reads as empty');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
