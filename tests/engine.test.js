/* Run with: node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const D = require('../js/data.js');

const close = (a, b, tol = 0.01, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tol ${tol})`);

const track = (o) => Object.assign({ type: 'fixed_unlinked', method: 'spitzer', amount: 1000000, months: 360, rate: 5, advanced: {} }, o);
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

// ---- Independent reference values (standard amortization tables / Excel PMT) ----
test('PMT matches published reference values', () => {
  close(E.pmt(1000000, 0.05 / 12, 360), 5368.22, 0.005, '1M @5% 30y');
  close(E.pmt(100000, 0.06 / 12, 360), 599.55, 0.005, '100k @6% 30y');
  close(E.pmt(500000, 0.04 / 12, 240), 3029.90, 0.005, '500k @4% 20y');
  close(E.pmt(200000, 0.065 / 12, 180), 1742.21, 0.005, '200k @6.5% 15y');
  close(E.pmt(120000, 0, 12), 10000, 1e-9, 'zero rate');
});

test('NPER inverts PMT', () => {
  const p = E.pmt(800000, 0.045 / 12, 300);
  assert.equal(E.nper(800000, 0.045 / 12, p), 300);
  assert.equal(E.nper(800000, 0.045 / 12, 1), Infinity);
});

test('Spitzer unlinked: payment, totals, balance hits zero', () => {
  const s = E.scheduleTrack(track());
  assert.equal(s.rows.length, 360);
  close(s.rows[0].regular, 5368.22, 0.005);
  close(s.rows[0].interest, 4166.67, 0.005);
  close(s.rows[359].regular, 5368.22, 0.005, 'payment constant');
  close(s.summary.totalPaid, 1932557.84, 0.05);
  close(s.summary.totalInterest, 932557.84, 0.05);
  close(s.rows[359].closing, 0, 1e-6);
  close(sum(s.rows, 'principal'), 1000000, 1e-4);
});

test('Equal principal (קרן שווה): textbook example', () => {
  const s = E.scheduleTrack(track({ method: 'equal', amount: 120000, months: 12, rate: 12 }));
  s.rows.forEach((r) => close(r.principal, 10000, 1e-6));
  close(s.rows[0].regular, 11200, 1e-6);
  close(s.rows[11].regular, 10100, 1e-6);
  close(s.summary.totalInterest, 7800, 1e-6); // 1% * 120000 * 13/2
  close(s.summary.maxPayment, 11200, 1e-6);
});

test('Bullet: interest only, principal in last month', () => {
  const s = E.scheduleTrack(track({ method: 'bullet', amount: 300000, months: 60, rate: 6 }));
  close(s.rows[0].regular, 1500, 1e-6);
  close(s.rows[58].regular, 1500, 1e-6);
  close(s.rows[59].regular, 301500, 1e-6);
  close(s.summary.totalInterest, 90000, 1e-6);
});

test('CPI monthly rate compounds to the annual figure', () => {
  close(Math.pow(1 + E.monthlyCpi(3), 12), 1.03, 1e-12);
});

test('CPI-linked Spitzer: payment grows exactly with the index; balance closes', () => {
  const cpi = 3;
  const c = E.monthlyCpi(cpi);
  const s = E.scheduleTrack(track({ type: 'fixed_linked', rate: 3, cpi, months: 240, amount: 500000 }));
  const p0 = E.pmt(500000, 0.03 / 12, 240);
  close(s.rows[0].regular, p0 * (1 + c), 1e-6, 'first payment indexed one month');
  close(s.rows[119].regular, p0 * Math.pow(1 + c, 120), 1e-6, 'month 120');
  close(s.rows[239].closing, 0, 1e-6);
  // principal repaid = original amount + indexation
  close(sum(s.rows, 'principal'), 500000 + s.summary.totalIndexation, 1e-4);
  assert.ok(s.summary.totalIndexation > 0);
  close(s.summary.totalPaid, s.summary.amount + s.summary.totalInterest + s.summary.totalIndexation, 1e-4);
});

test('Unlinked track ignores CPI input', () => {
  const s = E.scheduleTrack(track({ cpi: 5 }));
  assert.equal(s.summary.totalIndexation, 0);
});

test('Prime track: rate = prime + margin', () => {
  const s = E.scheduleTrack(track({ type: 'prime', rate: -0.5 }), { prime: 6 });
  assert.equal(s.params.annualRate, 5.5);
  close(s.rows[0].regular, E.pmt(1000000, 0.055 / 12, 360), 1e-6);
});

test('Partial grace: interest only, then annuity over the remaining term', () => {
  const s = E.scheduleTrack(track({ amount: 600000, months: 240, rate: 4.8, advanced: { graceMonths: 24 } }));
  close(s.rows[0].regular, 2400, 1e-6);
  close(s.rows[23].regular, 2400, 1e-6);
  close(s.rows[24].regular, E.pmt(600000, 0.004, 216), 1e-6);
  assert.equal(s.rows.length, 240);
  close(s.rows[239].closing, 0, 1e-6);
});

test('Full grace: nothing paid, interest capitalizes', () => {
  const s = E.scheduleTrack(track({ amount: 100000, months: 120, rate: 6, advanced: { graceMonths: 12, graceType: 'full' } }));
  close(s.rows[0].regular, 0, 1e-9);
  close(s.rows[11].closing, 100000 * Math.pow(1.005, 12), 1e-6);
  close(s.rows[12].regular, E.pmt(100000 * Math.pow(1.005, 12), 0.005, 108), 1e-6);
});

test('Future rate change applies from the given month', () => {
  const s = E.scheduleTrack(track({ type: 'prime', rate: 0, months: 300, amount: 400000, advanced: { rateChangeMonth: 25, rateChangeDelta: 2 } }), { prime: 6 });
  close(s.rows[23].regular, E.pmt(400000, 0.005, 300), 1e-6);
  const bal = s.rows[23].closing;
  close(s.rows[24].regular, E.pmt(bal, 0.08 / 12, 276), 1e-6);
  assert.equal(s.rows[24].rate, 8);
});

test('Scenario stress applies only to variable tracks', () => {
  const sc = { prime: 6, stressDelta: 3, stressMonth: 13 };
  const v = E.scheduleTrack(track({ type: 'prime', rate: 0 }), sc);
  const f = E.scheduleTrack(track({ type: 'fixed_unlinked' }), sc);
  assert.equal(v.rows[12].rate, 9);
  assert.equal(f.rows[12].rate, 5);
});

test('Partial prepayment – reduce payment keeps the term', () => {
  const s = E.scheduleTrack(track({ amount: 500000, months: 240, rate: 4, advanced: { prepayMonth: 60, prepayType: 'partial', prepayAmount: 100000, prepayMode: 'reduce' } }));
  assert.equal(s.rows.length, 240);
  const after = s.rows[59].closing;
  close(s.rows[59].prepay, 100000, 1e-9);
  close(s.rows[60].regular, E.pmt(after, 0.04 / 12, 180), 1e-6);
  assert.ok(s.rows[60].regular < s.rows[58].regular);
  close(s.rows[239].closing, 0, 1e-6);
});

test('Partial prepayment – shorten term keeps the payment', () => {
  const base = E.scheduleTrack(track({ amount: 500000, months: 240, rate: 4 }));
  const s = E.scheduleTrack(track({ amount: 500000, months: 240, rate: 4, advanced: { prepayMonth: 60, prepayType: 'partial', prepayAmount: 100000, prepayMode: 'shorten' } }));
  const P = base.rows[0].regular;
  const after = s.rows[59].closing;
  const k = E.nper(after, 0.04 / 12, P);
  assert.equal(s.rows.length, 60 + k);
  assert.ok(s.rows.length < 240);
  // payment stays (slightly lower only because of ceil on the number of months)
  assert.ok(s.rows[60].regular <= P + 1e-9 && s.rows[60].regular > P * 0.97);
  close(s.rows[s.rows.length - 1].closing, 0, 1e-6);
  assert.ok(s.summary.totalInterest < base.summary.totalInterest);
});

test('Full prepayment closes the track at that month', () => {
  const s = E.scheduleTrack(track({ amount: 300000, months: 240, rate: 5, advanced: { prepayMonth: 36, prepayType: 'full' } }));
  assert.equal(s.rows.length, 36);
  close(s.rows[35].closing, 0, 1e-9);
  close(sum(s.rows, 'principal') + s.summary.totalPrepay, 300000, 1e-4);
});

test('Equal principal – shorten term keeps principal portion', () => {
  const s = E.scheduleTrack(track({ method: 'equal', amount: 240000, months: 240, rate: 3, advanced: { prepayMonth: 12, prepayType: 'partial', prepayAmount: 48000, prepayMode: 'shorten' } }));
  close(s.rows[12].principal, 1000, 1e-6);
  assert.equal(s.rows.length, 12 + 180); // 180,000 / 1,000
});

test('Mix: totals add up and effective rate equals nominal effective without fees', () => {
  const offer = { name: 'x', tracks: [
    track({ amount: 400000, months: 300, rate: 5 }),
    track({ amount: 400000, months: 300, rate: 5, type: 'prime', rate: -1 }),
  ], fees: {} };
  const r = E.computeOffer(offer, { prime: 6 });
  close(r.summary.amount, 800000, 1e-9);
  close(r.summary.weightedRate, 5, 1e-9);
  close(r.summary.firstPayment, 2 * E.pmt(400000, 0.05 / 12, 300), 1e-6);
  close(r.summary.effectiveRate, (Math.pow(1 + 0.05 / 12, 12) - 1) * 100, 1e-4);
  close(r.summary.perShekel, r.summary.totalPaid / 800000, 1e-12);
});

test('Fees raise the effective rate and total cost', () => {
  const t = [track({ amount: 1000000, months: 360, rate: 5 })];
  const a = E.computeOffer({ tracks: t, fees: {} });
  const b = E.computeOffer({ tracks: t, fees: { oneTime: 10000, monthly: 10 } });
  assert.ok(b.summary.effectiveRate > a.summary.effectiveRate);
  close(b.summary.totalCost - a.summary.totalCost, 10000 + 3600, 1e-6);
});

test('Validation catches bad inputs and BoI one-third fixed rule', () => {
  const bad = E.validateTrack({ type: 'fixed_unlinked', amount: '', months: 400, rate: '' });
  const fields = bad.map((e) => e.field);
  assert.ok(fields.includes('amount') && fields.includes('months') && fields.includes('rate'));
  const r = E.computeOffer({ tracks: [track({ type: 'prime', rate: 0 })] }, { prime: 6 });
  assert.ok(r.warnings.some((w) => w.includes('שליש')));
  const g = E.validateTrack(track({ months: 24, advanced: { graceMonths: 30 } }));
  assert.ok(g.some((e) => e.field === 'graceMonths'));
});

test('Indicative range lookup', () => {
  assert.deepEqual(D.indicativeRange('fixed_unlinked', 300), { min: 4.75, max: 5.25 });
  assert.deepEqual(D.indicativeRange('fixed_linked', 48), { min: 2.5, max: 3.5 });
  assert.equal(D.indicativeRange('zakaut', 48), null);
});

test('Yearly aggregation preserves totals', () => {
  const s = E.scheduleTrack(track({ months: 125 }));
  const y = E.yearly(s.rows);
  assert.equal(y.length, 11);
  close(y.reduce((a, b) => a + b.interest, 0), s.summary.totalInterest, 1e-6);
});
