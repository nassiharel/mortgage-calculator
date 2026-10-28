/* State serialization for shareable links and local persistence.
 * Format: '#c=' + base64url(UTF-8 JSON of a compact, versioned state).
 * Compression via CompressionStream (deflate-raw) when available, prefixed with 'z'.
 * UMD: window.MortgageShare / module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MortgageShare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;

  // ---- compact <-> full mapping (keeps URLs short) ----
  function packTrack(t) {
    var a = t.advanced || {};
    var o = { y: t.type, m: t.method, a: t.amount, n: t.months, r: t.rate };
    if (t.cpi !== '' && t.cpi !== undefined && t.cpi !== null) o.c = t.cpi;
    var adv = {};
    if (a.graceMonths) { adv.g = a.graceMonths; if (a.graceType === 'full') adv.gt = 1; }
    if (a.rateChangeMonth) { adv.rm = a.rateChangeMonth; adv.rd = a.rateChangeDelta; }
    if (a.prepayMonth) { adv.pm = a.prepayMonth; adv.pt = a.prepayType === 'full' ? 1 : 0; adv.pa = a.prepayAmount; adv.pd = a.prepayMode === 'shorten' ? 1 : 0; }
    if (Object.keys(adv).length) o.x = adv;
    return o;
  }
  function unpackTrack(o) {
    var x = o.x || {};
    return {
      type: o.y, method: o.m, amount: o.a, months: o.n, rate: o.r, cpi: o.c === undefined ? '' : o.c,
      advanced: {
        graceMonths: x.g || '', graceType: x.gt ? 'full' : 'partial',
        rateChangeMonth: x.rm || '', rateChangeDelta: x.rd === undefined ? '' : x.rd,
        prepayMonth: x.pm || '', prepayType: x.pt ? 'full' : 'partial', prepayAmount: x.pa === undefined ? '' : x.pa,
        prepayMode: x.pd ? 'shorten' : 'reduce'
      }
    };
  }

  function pack(state) {
    return {
      v: VERSION,
      t: state.title || '',
      s: { p: state.scenario.prime, c: state.scenario.cpi, so: state.scenario.stressOn ? 1 : 0, sd: state.scenario.stressDelta, sm: state.scenario.stressMonth },
      b: { i: state.borrower.income, pv: state.borrower.propertyValue, pt: state.borrower.propertyType },
      o: state.offers.map(function (of) {
        return { n: of.name, f: [of.fees.oneTime, of.fees.monthly], nt: of.notes || '', k: of.tracks.map(packTrack) };
      })
    };
  }

  function unpack(p) {
    if (!p || typeof p !== 'object' || p.v !== VERSION || !Array.isArray(p.o)) throw new Error('bad state');
    var s = p.s || {}, b = p.b || {};
    return {
      title: String(p.t || ''),
      scenario: { prime: s.p, cpi: s.c, stressOn: !!s.so, stressDelta: s.sd, stressMonth: s.sm },
      borrower: { income: b.i || '', propertyValue: b.pv || '', propertyType: b.pt || 'single' },
      offers: p.o.slice(0, 4).map(function (o) {
        var f = o.f || [];
        return { name: String(o.n || ''), notes: String(o.nt || ''), fees: { oneTime: f[0] || '', monthly: f[1] || '' },
          tracks: (o.k || []).slice(0, 12).map(unpackTrack) };
      })
    };
  }

  // ---- base64url helpers ----
  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hasCompression() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';
  }

  function streamBytes(bytes, stream) {
    var s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /** Encode state → string (async). */
  function encode(state) {
    var json = JSON.stringify(pack(state));
    var bytes = new TextEncoder().encode(json);
    if (hasCompression()) {
      return streamBytes(bytes, new CompressionStream('deflate-raw'))
        .then(function (z) { return 'z' + bytesToB64url(z); })
        .catch(function () { return 'j' + bytesToB64url(bytes); });
    }
    return Promise.resolve('j' + bytesToB64url(bytes));
  }

  /** Decode string → state (async). Rejects on invalid input. */
  function decode(str) {
    try {
      var kind = str.charAt(0), body = str.slice(1);
      var bytes = b64urlToBytes(body);
      var p = kind === 'z'
        ? (hasCompression() ? streamBytes(bytes, new DecompressionStream('deflate-raw')) : Promise.reject(new Error('no decompression')))
        : Promise.resolve(bytes);
      return p.then(function (b) { return unpack(JSON.parse(new TextDecoder().decode(b))); });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  return { pack: pack, unpack: unpack, encode: encode, decode: decode, VERSION: VERSION };
});
