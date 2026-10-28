/* Mortgage calculation engine (pure functions, no DOM).
 *
 * Conventions (match Israeli bank practice):
 *  - Rates are annual nominal; monthly rate = annual / 12 (monthly compounding).
 *  - CPI: the annual expected inflation is converted to an equivalent compound monthly
 *    rate: (1 + cpi)^(1/12) - 1, so 12 months of indexation equal exactly the annual figure.
 *  - Each month on a CPI-linked track: the opening balance is first indexed, then interest
 *    and the payment are computed on the indexed balance (this is how Israeli amortization
 *    schedules are built; it makes a linked Spitzer payment grow exactly with the index).
 *  - Payments are recomputed every month from the remaining balance and remaining term, so
 *    rate changes, CPI and prepayments propagate without accumulated drift.
 *  - All arithmetic is full floating point; rounding happens only for display.
 *
 * UMD: window.MortgageEngine in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.MortgageEngine = factory(root.MortgageData);
})(typeof self !== 'undefined' ? self : this, function (Data) {
  'use strict';

  var EPS = 1e-7;

  function num(v, def) {
    if (v === '' || v === null || v === undefined) return def;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s₪%]/g, ''));
    return isFinite(n) ? n : def;
  }

  /** Standard annuity payment (Spitzer). */
  function pmt(principal, monthlyRate, months) {
    if (months <= 0) return principal;
    if (Math.abs(monthlyRate) < 1e-12) return principal / months;
    return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  }

  /** Number of months needed to repay `principal` with payment `payment` (ceil). */
  function nper(principal, monthlyRate, payment) {
    if (principal <= EPS) return 0;
    if (payment <= 0) return Infinity;
    if (Math.abs(monthlyRate) < 1e-12) return Math.ceil(principal / payment - 1e-9);
    var x = 1 - principal * monthlyRate / payment;
    if (x <= 0) return Infinity; // payment does not even cover interest
    return Math.ceil(-Math.log(x) / Math.log(1 + monthlyRate) - 1e-9);
  }

  function monthlyCpi(annualPct) {
    return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  }

  /**
   * Resolve a track definition into normalized numeric parameters.
   * scenario: { prime, cpi, stressDelta, stressMonth }
   */
  function normalizeTrack(track, scenario) {
    var type = Data.TRACK_BY_ID[track.type] || Data.TRACK_BY_ID.fixed_unlinked;
    var sc = scenario || {};
    var baseInput = num(track.rate, NaN);
    var annual = type.rateMode === 'prime' ? num(sc.prime, Data.DEFAULT_PRIME) + baseInput : baseInput;
    var cpi = 0;
    if (type.linked) cpi = num(track.cpi, num(sc.cpi, Data.DEFAULT_CPI));
    var months = Math.round(num(track.months, 0));
    var adv = track.advanced || {};
    var grace = Math.min(Math.round(num(adv.graceMonths, 0)), Math.max(months - 1, 0));
    var changes = [];
    if (adv.rateChangeMonth && num(adv.rateChangeDelta, 0) !== 0) {
      changes.push({ month: Math.round(num(adv.rateChangeMonth, 0)), delta: num(adv.rateChangeDelta, 0) });
    }
    if (type.kind === 'variable' && num(sc.stressDelta, 0) !== 0 && num(sc.stressMonth, 0) > 0) {
      changes.push({ month: Math.round(num(sc.stressMonth, 0)), delta: num(sc.stressDelta, 0) });
    }
    var prepay = null;
    if (adv.prepayMonth && (adv.prepayType === 'full' || num(adv.prepayAmount, 0) > 0)) {
      prepay = {
        month: Math.round(num(adv.prepayMonth, 0)),
        type: adv.prepayType === 'full' ? 'full' : 'partial',
        amount: num(adv.prepayAmount, 0),
        mode: adv.prepayMode === 'shorten' && track.method !== 'bullet' ? 'shorten' : 'reduce'
      };
    }
    return {
      typeDef: type,
      amount: num(track.amount, 0),
      method: track.method === 'equal' || track.method === 'bullet' ? track.method : 'spitzer',
      months: months,
      annualRate: annual,
      cpiAnnual: cpi,
      graceMonths: grace,
      graceType: adv.graceType === 'full' ? 'full' : 'partial',
      changes: changes,
      prepay: prepay
    };
  }

  function rateAt(p, month) {
    var r = p.annualRate;
    for (var i = 0; i < p.changes.length; i++) if (month >= p.changes[i].month) r += p.changes[i].delta;
    return r;
  }

  /** Validate a track; returns array of {field, msg} (Hebrew). */
  function validateTrack(track, scenario) {
    var errs = [];
    var type = Data.TRACK_BY_ID[track.type];
    var amount = num(track.amount, NaN);
    var months = num(track.months, NaN);
    var rate = num(track.rate, NaN);
    if (!type) errs.push({ field: 'type', msg: 'יש לבחור מסלול' });
    if (!(amount > 0)) errs.push({ field: 'amount', msg: 'יש להזין סכום חיובי' });
    else if (amount > 50000000) errs.push({ field: 'amount', msg: 'הסכום גבוה מדי' });
    if (!(months >= 1 && months <= Data.MAX_MONTHS && Math.round(months) === months)) {
      errs.push({ field: 'months', msg: 'תקופה בין 1 ל-360 חודשים (30 שנה)' });
    } else if (type && type.durations && type.durations.indexOf(months) === -1) {
      errs.push({ field: 'months', msg: 'במסלול זה התקופה מקובלת בכפולות של תקופת השינוי (למשל ' + type.durations.slice(0, 3).join(', ') + '…)', soft: true });
    }
    if (!isFinite(rate)) errs.push({ field: 'rate', msg: type && type.rateMode === 'prime' ? 'יש להזין מרווח מהפריים (למשל ‎-0.5)' : 'יש להזין ריבית' });
    else {
      var annual = type && type.rateMode === 'prime' ? num((scenario || {}).prime, Data.DEFAULT_PRIME) + rate : rate;
      if (annual < 0 || annual > 25) errs.push({ field: 'rate', msg: 'ריבית שנתית צריכה להיות בין 0% ל-25%' });
    }
    if (type && type.linked && track.cpi !== '' && track.cpi !== undefined && track.cpi !== null) {
      var c = num(track.cpi, NaN);
      if (!isFinite(c) || c < -5 || c > 20) errs.push({ field: 'cpi', msg: 'מדד שנתי בין ‎-5% ל-20%' });
    }
    var adv = track.advanced || {};
    var g = num(adv.graceMonths, 0);
    if (g < 0 || g > Data.MAX_GRACE || Math.round(g) !== g) errs.push({ field: 'graceMonths', msg: 'גרייס עד 60 חודשים' });
    else if (months > 0 && g >= months) errs.push({ field: 'graceMonths', msg: 'הגרייס חייב להיות קצר מתקופת המסלול' });
    if (adv.rateChangeMonth) {
      var rm = num(adv.rateChangeMonth, NaN);
      if (!(rm >= 2 && rm <= months)) errs.push({ field: 'rateChangeMonth', msg: 'חודש השינוי חייב להיות בתוך תקופת המסלול' });
      var d = num(adv.rateChangeDelta, NaN);
      if (!isFinite(d) || d < -10 || d > 10) errs.push({ field: 'rateChangeDelta', msg: 'שינוי ריבית בין ‎-10% ל-10%' });
    }
    if (adv.prepayMonth) {
      var pm = num(adv.prepayMonth, NaN);
      if (!(pm >= 1 && pm < months)) errs.push({ field: 'prepayMonth', msg: 'מועד הסילוק חייב להיות לפני סוף המסלול' });
      if (adv.prepayType !== 'full' && !(num(adv.prepayAmount, 0) > 0)) errs.push({ field: 'prepayAmount', msg: 'יש להזין סכום לסילוק' });
    }
    return errs;
  }

  /**
   * Build the full monthly amortization schedule for one track.
   * Returns { rows: [...], summary }.
   * Row: { month, rate, opening, indexation, interest, principal, prepay, payment, closing }
   *  - opening: balance before indexation; closing: balance after payment and prepayment.
   *  - payment: total paid this month including any prepayment.
   */
  function scheduleTrack(track, scenario) {
    var p = normalizeTrack(track, scenario);
    var rows = [];
    var bal = p.amount;
    var n = p.months;
    var cpiM = monthlyCpi(p.cpiAnnual);
    var endMonth = n;               // may shrink with a "shorten term" prepayment
    // Pending "shorten term" target: the payment (Spitzer) or principal portion (equal) to keep,
    // expressed in nominal terms at the prepayment month and indexed forward by CPI.
    var shorten = null;

    for (var m = 1; m <= endMonth && bal > EPS; m++) {
      var annual = rateAt(p, m);
      var r = annual / 1200;
      var opening = bal;
      var indexation = opening * cpiM;
      var indexed = opening + indexation;
      var interest = indexed * r;
      var principal = 0;
      var payment = 0;
      var inGrace = m <= p.graceMonths;

      if (shorten && !inGrace) {
        // First amortizing month after the prepayment: recompute the end of the loan once.
        shorten.target *= Math.pow(1 + cpiM, m - shorten.month);
        var k = p.method === 'spitzer' ? nper(indexed, r, shorten.target)
                                       : Math.ceil(indexed / shorten.target - 1e-9);
        if (isFinite(k) && k >= 1) endMonth = Math.min(endMonth, m + k - 1);
        shorten = null;
      }
      var remaining = endMonth - m + 1;

      if (inGrace) {
        if (p.graceType === 'full') { payment = 0; principal = -interest; } // interest capitalized
        else { payment = interest; principal = 0; }
      } else if (p.method === 'spitzer') {
        payment = pmt(indexed, r, remaining);
        principal = payment - interest;
      } else if (p.method === 'equal') {
        principal = indexed / remaining;
        payment = principal + interest;
      } else { // bullet
        principal = m === endMonth ? indexed : 0;
        payment = principal + interest;
      }

      var closing = indexed - principal;
      if (m === endMonth && !inGrace && Math.abs(closing) < 1e-4) closing = 0;

      // Future prepayment, applied after the regular payment of that month
      var prepayAmt = 0;
      if (p.prepay && p.prepay.month === m && closing > EPS) {
        prepayAmt = p.prepay.type === 'full' ? closing : Math.min(p.prepay.amount, closing);
        closing -= prepayAmt;
        if (closing <= EPS) { closing = 0; }
        else if (p.prepay.mode === 'shorten') {
          // Keep the payment level that would have applied without the prepayment.
          var before = closing + prepayAmt;
          var target;
          if (m > p.graceMonths) {
            target = p.method === 'spitzer' ? payment : principal;
          } else {
            var amortMonths = endMonth - p.graceMonths;
            target = p.method === 'spitzer' ? pmt(before, rateAt(p, p.graceMonths + 1) / 1200, amortMonths)
                                            : before / amortMonths;
          }
          shorten = { month: m, target: target };
        }
      }

      rows.push({
        month: m,
        balloon: p.method === 'bullet' && m === endMonth ? principal : 0,
        rate: annual,
        opening: opening,
        indexation: indexation,
        interest: interest,
        principal: principal,
        prepay: prepayAmt,
        payment: payment + prepayAmt,
        regular: payment,
        closing: closing
      });
      bal = closing;
    }
    return { rows: rows, params: p, summary: summarizeRows(rows, p.amount) };
  }

  function summarizeRows(rows, amount) {
    var s = { amount: amount, totalPaid: 0, totalInterest: 0, totalIndexation: 0, totalPrepay: 0,
      firstPayment: rows.length ? rows[0].regular - (rows[0].balloon || 0) : 0, maxPayment: 0, maxPaymentMonth: 0,
      totalBalloon: 0, months: rows.length };
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      s.totalPaid += r.payment;
      s.totalInterest += r.interest;
      s.totalIndexation += r.indexation;
      s.totalPrepay += r.prepay;
      s.totalBalloon += r.balloon || 0;
      var regularNoBalloon = r.regular - (r.balloon || 0);
      if (regularNoBalloon > s.maxPayment + 1e-9) { s.maxPayment = regularNoBalloon; s.maxPaymentMonth = r.month; }
    }
    return s;
  }

  /**
   * Compute a whole offer (mix of tracks).
   * offer: { name, tracks: [...], fees: { oneTime, monthly } }
   * Returns { tracks: [{track, schedule, errors}], rows (combined monthly), summary, errors, warnings }
   */
  function computeOffer(offer, scenario, borrower) {
    var res = { tracks: [], rows: [], errors: [], warnings: [], summary: null };
    var valid = [];
    (offer.tracks || []).forEach(function (t, idx) {
      var errs = validateTrack(t, scenario);
      var hard = errs.filter(function (e) { return !e.soft; });
      var item = { track: t, index: idx, errors: errs, schedule: null };
      if (!hard.length) { item.schedule = scheduleTrack(t, scenario); valid.push(item); }
      res.tracks.push(item);
    });
    if (!valid.length) return res;

    var maxLen = 0;
    valid.forEach(function (v) { maxLen = Math.max(maxLen, v.schedule.rows.length); });
    var monthlyFee = num((offer.fees || {}).monthly, 0);
    for (var m = 0; m < maxLen; m++) {
      var row = { month: m + 1, opening: 0, indexation: 0, interest: 0, principal: 0, prepay: 0, payment: 0, regular: 0, closing: 0, balloon: 0 };
      valid.forEach(function (v) {
        var r = v.schedule.rows[m];
        if (!r) return;
        row.balloon += r.balloon;
        row.opening += r.opening; row.indexation += r.indexation; row.interest += r.interest;
        row.principal += r.principal; row.prepay += r.prepay; row.payment += r.payment;
        row.regular += r.regular; row.closing += r.closing;
      });
      res.rows.push(row);
    }

    var s = summarizeRows(res.rows, 0);
    var amount = 0, wRate = 0, fixedAmt = 0, linkedAmt = 0, varAmt = 0, primeAmt = 0, shortVarAmt = 0;
    valid.forEach(function (v) {
      var p = v.schedule.params;
      amount += p.amount;
      wRate += p.amount * p.annualRate;
      if (p.typeDef.kind === 'fixed') fixedAmt += p.amount; else varAmt += p.amount;
      if (p.typeDef.linked) linkedAmt += p.amount;
      if (p.typeDef.id === 'prime') primeAmt += p.amount;
    });
    s.amount = amount;
    s.weightedRate = amount ? wRate / amount : 0;
    s.fixedShare = amount ? fixedAmt / amount : 0;
    s.variableShare = amount ? varAmt / amount : 0;
    s.linkedShare = amount ? linkedAmt / amount : 0;
    s.primeShare = amount ? primeAmt / amount : 0;
    s.perShekel = amount ? s.totalPaid / amount : 0;
    s.feesOneTime = num((offer.fees || {}).oneTime, 0);
    s.feesMonthly = monthlyFee;
    s.feesTotal = s.feesOneTime + monthlyFee * s.months;
    s.totalCost = s.totalPaid + s.feesTotal;
    s.costOfCredit = s.totalPaid - amount + s.feesTotal; // everything paid beyond principal
    s.payment5y = res.rows[60] ? res.rows[60].regular - res.rows[60].balloon : 0;
    s.balance5y = res.rows[59] ? res.rows[59].closing : 0;
    s.effectiveRate = effectiveAnnualRate(amount, s.feesOneTime, res.rows, monthlyFee);
    res.summary = s;

    // Regulatory / sanity warnings (soft — informational only)
    if (s.fixedShare < 1 / 3 - 1e-9) res.warnings.push('לפי הוראות בנק ישראל, לפחות שליש מהמשכנתא צריך להיות בריבית קבועה (כרגע ' + Math.round(s.fixedShare * 100) + '%).');
    if (offer.tracks.length && valid.length < offer.tracks.length) res.warnings.push('חלק מהמסלולים אינם מלאים ואינם נכללים בחישוב.');
    if (borrower) {
      var income = num(borrower.income, 0);
      if (income > 0) {
        var pti = s.maxPayment / income;
        s.pti = s.firstPayment / income;
        s.ptiMax = pti;
        if (s.firstPayment / income > 0.5) res.warnings.push('ההחזר החודשי עולה על 50% מההכנסה – בנק ישראל אינו מתיר זאת.');
        else if (pti > 0.4) res.warnings.push('ההחזר המקסימלי הצפוי (' + Math.round(pti * 100) + '% מההכנסה) גבוה מ-40% – רמת סיכון מוגברת.');
      }
      var value = num(borrower.propertyValue, 0);
      if (value > 0) {
        s.ltv = amount / value;
        var pt = Data.PROPERTY_TYPES.filter(function (x) { return x.id === borrower.propertyType; })[0] || Data.PROPERTY_TYPES[0];
        if (s.ltv > pt.ltv + 1e-9) res.warnings.push('שיעור המימון (' + Math.round(s.ltv * 100) + '%) חורג מהתקרה ל' + pt.name + ' (' + Math.round(pt.ltv * 100) + '%).');
      }
    }
    return res;
  }

  /** Annualized IRR of the borrower's cash flows: +amount - fees at t0, -payments monthly. */
  function effectiveAnnualRate(amount, feesOneTime, rows, monthlyFee) {
    if (!(amount > 0) || !rows.length) return 0;
    var cf0 = amount - (feesOneTime || 0);
    var flows = rows.map(function (r) { return r.payment + (monthlyFee || 0); });
    function npv(i) {
      var v = cf0, d = 1;
      for (var k = 0; k < flows.length; k++) { d /= (1 + i); v -= flows[k] * d; }
      return v;
    }
    // Bisection on the monthly rate. npv(i) is increasing in i (payments are discounted more),
    // so npv<0 means i is too low.
    var lo = -0.02, hi = 0.1;
    if (npv(lo) > 0 || npv(hi) < 0) return NaN;
    for (var it = 0; it < 200; it++) {
      var mid = (lo + hi) / 2;
      var v = npv(mid);
      if (Math.abs(v) < 1e-9) { lo = hi = mid; break; }
      if (v < 0) lo = mid; else hi = mid;
    }
    var im = (lo + hi) / 2;
    return (Math.pow(1 + im, 12) - 1) * 100;
  }

  /** Year-level aggregation of combined monthly rows. */
  function yearly(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i += 12) {
      var y = { year: i / 12 + 1, opening: rows[i].opening, firstPayment: rows[i].regular, interest: 0, principal: 0, indexation: 0, prepay: 0, payment: 0, closing: 0 };
      for (var k = i; k < Math.min(i + 12, rows.length); k++) {
        y.interest += rows[k].interest; y.principal += rows[k].principal; y.indexation += rows[k].indexation;
        y.prepay += rows[k].prepay; y.payment += rows[k].payment; y.closing = rows[k].closing;
      }
      out.push(y);
    }
    return out;
  }

  return {
    pmt: pmt,
    nper: nper,
    monthlyCpi: monthlyCpi,
    num: num,
    normalizeTrack: normalizeTrack,
    validateTrack: validateTrack,
    scheduleTrack: scheduleTrack,
    computeOffer: computeOffer,
    effectiveAnnualRate: effectiveAnnualRate,
    yearly: yearly
  };
});
