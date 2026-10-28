/* Static domain data: track types, allowed durations, indicative rate ranges, glossary.
 * UMD: works as a browser global (window.MortgageData) and as a CommonJS module (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MortgageData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function range(from, to, step) {
    var out = [];
    for (var i = from; i <= to; i += step || 1) out.push(i);
    return out;
  }

  /*
   * kind:      'fixed'   – rate fixed for the whole term (counts toward Bank of Israel 1/3 fixed minimum)
   *            'variable'– rate may change (prime, anchors, variable every N years, foreign currency)
   * linked:    CPI-linked (principal is indexed monthly to the consumer price index)
   * rateMode:  'rate' – user enters the full annual nominal rate
   *            'prime' – user enters the margin from prime (prime = BoI rate + 1.5%)
   * durations: null = any 1..360 months; otherwise the allowed list (mirrors the reference calculator)
   * range:     indicative [min,max] rate (or margin for prime) by term bucket in years (5,10,...,30).
   *            Source: reference site's published table; shown only as a soft hint.
   */
  var TRACKS = [
    { id: 'prime', name: 'פריים', short: 'פריים', kind: 'variable', linked: false, rateMode: 'prime', durations: null,
      desc: 'ריבית משתנה הצמודה לריבית בנק ישראל (פריים = ריבית בנק ישראל + 1.5%). ההחזר משתנה עם כל שינוי בריבית בנק ישראל. אינו צמוד למדד.',
      range: { 5: [-0.75, 0.25], 10: [-0.75, 0.25], 15: [-0.75, 0.25], 20: [-0.75, 0.25], 25: [-0.75, 0.25], 30: [-0.75, 0.25] } },
    { id: 'fixed_linked', name: 'קבועה צמודה (ק"צ)', short: 'ק"צ', kind: 'fixed', linked: true, rateMode: 'rate', durations: null,
      desc: 'ריבית קבועה לכל התקופה, אך הקרן צמודה למדד המחירים לצרכן – כשהמדד עולה, היתרה וההחזר עולים.',
      range: { 5: [2.5, 3.5], 10: [2.5, 3.5], 15: [2.5, 3.5], 20: [2.5, 3.5], 25: [2.75, 3.5], 30: [2.75, 3.5] } },
    { id: 'fixed_unlinked', name: 'קבועה לא צמודה (קל"צ)', short: 'קל"צ', kind: 'fixed', linked: false, rateMode: 'rate', durations: null,
      desc: 'ריבית קבועה ללא הצמדה למדד – ההחזר החודשי ידוע מראש לכל התקופה (בלוח שפיצר). בדרך כלל הריבית ההתחלתית גבוהה יותר.',
      range: { 5: [4, 4.75], 10: [4, 4.75], 15: [4.5, 5], 20: [4.75, 5.25], 25: [4.75, 5.25], 30: [4.75, 5.5] } },
    { id: 'var5_linked', name: 'משתנה כל 5 צמודה (מ"צ)', short: 'מ"צ 5', kind: 'variable', linked: true, rateMode: 'rate', durations: [60, 120, 180, 240, 300, 360],
      desc: 'ריבית המתעדכנת כל 5 שנים לפי עוגן, והקרן צמודה למדד.',
      range: { 5: [3.75, 4.75], 10: [3.75, 4.75], 15: [3.75, 4.75], 20: [3.75, 4.75], 25: [3.75, 4.75], 30: [3.75, 4.75] } },
    { id: 'var5_unlinked', name: 'משתנה כל 5 לא צמודה (מל"צ)', short: 'מל"צ 5', kind: 'variable', linked: false, rateMode: 'rate', durations: [60, 120, 180, 240, 300, 360],
      desc: 'ריבית המתעדכנת כל 5 שנים לפי עוגן (תשואת אג"ח ממשלתי), ללא הצמדה למדד.',
      range: { 5: [4.25, 5], 10: [4.25, 5], 15: [4.25, 5], 20: [4.25, 5], 25: [4.25, 5.25], 30: [4.25, 5.25] } },
    { id: 'zakaut', name: 'זכאות משרד השיכון', short: 'זכאות', kind: 'fixed', linked: true, rateMode: 'rate', durations: null,
      desc: 'הלוואה בתנאים מועדפים למי שקיבל תעודת זכאות ממשרד הבינוי והשיכון. ריבית קבועה צמודה למדד, בסכום מוגבל.',
      range: { 10: [2.31, 2.31], 15: [2.35, 2.35], 20: [2.41, 2.41], 25: [2.65, 2.65], 30: [2.72, 2.72] } },
    { id: 'euro', name: 'יורו', short: 'יורו', kind: 'variable', linked: false, rateMode: 'rate', durations: null,
      desc: 'הלוואה צמודה לשער היורו. המחשבון אינו מדמה שינויי שער מטבע – הסיכון בפועל גבוה יותר מהמוצג.',
      range: { 5: [3, 4], 10: [3, 4], 15: [3, 4], 20: [3, 4], 25: [3, 4], 30: [3, 4] } },
    { id: 'dollar', name: 'דולר', short: 'דולר', kind: 'variable', linked: false, rateMode: 'rate', durations: null,
      desc: 'הלוואה צמודה לשער הדולר. המחשבון אינו מדמה שינויי שער מטבע – הסיכון בפועל גבוה יותר מהמוצג.',
      range: { 5: [3, 4], 10: [3, 4], 15: [3, 4], 20: [3, 4], 25: [3, 4], 30: [3, 4] } },
    { id: 'makam', name: 'עוגן מק"מ', short: 'מק"מ', kind: 'variable', linked: false, rateMode: 'rate', durations: range(12, 360, 12),
      desc: 'ריבית משתנה (בדרך כלל כל שנה) לפי תשואת מלווה קצר מועד של בנק ישראל. אינו צמוד למדד.',
      range: { 5: [5.25, 6.25], 10: [5.25, 6.25], 15: [5.25, 6.25], 20: [5.25, 6.25], 25: [5.25, 6.25], 30: [5.25, 6.25] } },
    { id: 'var1_linked', name: 'משתנה כל שנה צמודה', short: 'מ"צ 1', kind: 'variable', linked: true, rateMode: 'rate', durations: range(12, 360, 12),
      desc: 'ריבית המתעדכנת מדי שנה, והקרן צמודה למדד.',
      range: { 5: [3, 4], 10: [3, 4], 15: [3, 4], 20: [3, 4], 25: [3, 4], 30: [3, 4.25] } },
    { id: 'var2_linked', name: 'משתנה כל שנתיים צמודה', short: 'מ"צ 2', kind: 'variable', linked: true, rateMode: 'rate',
      durations: [24, 48, 60, 84, 108, 132, 156, 180, 204, 228, 252, 276, 300, 324, 348],
      desc: 'ריבית המתעדכנת כל שנתיים, והקרן צמודה למדד.',
      range: { 5: [3, 4], 10: [3, 4], 15: [3, 4], 20: [3, 4], 25: [3, 4], 30: [3, 4] } },
    { id: 'var10_linked', name: 'משתנה כל 10 צמודה', short: 'מ"צ 10', kind: 'variable', linked: true, rateMode: 'rate', durations: [120, 240, 360],
      desc: 'ריבית המתעדכנת כל 10 שנים, והקרן צמודה למדד.',
      range: { 5: [3.75, 4.75], 10: [3.75, 4.75], 15: [3.75, 4.75], 20: [3.75, 4.75], 25: [3.75, 4.75], 30: [3.75, 4.75] } }
  ];

  var TRACK_BY_ID = {};
  TRACKS.forEach(function (t) { TRACK_BY_ID[t.id] = t; });

  var METHODS = [
    { id: 'spitzer', name: 'שפיצר', desc: 'החזר חודשי קבוע (לפני מדד ושינויי ריבית). בתחילת התקופה רוב התשלום הולך לריבית, ובהמשך לקרן. השיטה הנפוצה בישראל.' },
    { id: 'equal', name: 'קרן שווה', desc: 'החלק של הקרן בכל תשלום קבוע, והריבית יורדת עם הזמן – ההחזר ההתחלתי גבוה יותר, אך סך הריבית נמוך יותר.' },
    { id: 'bullet', name: 'בוליט', desc: 'משלמים ריבית בלבד מדי חודש, ואת כל הקרן בתשלום אחד בסוף התקופה (בלון).' }
  ];

  var PROPERTY_TYPES = [
    { id: 'single', name: 'דירה יחידה', ltv: 0.75 },
    { id: 'upgrade', name: 'משפרי דיור (דירה חלופית)', ltv: 0.70 },
    { id: 'investment', name: 'דירה נוספת / להשקעה', ltv: 0.50 }
  ];

  /** Indicative range for a track type and term (months). Returns null when unknown. */
  function indicativeRange(trackId, months) {
    var t = TRACK_BY_ID[trackId];
    if (!t || !months) return null;
    var years = Math.ceil(months / 12);
    var buckets = [5, 10, 15, 20, 25, 30];
    for (var i = 0; i < buckets.length; i++) {
      if (buckets[i] >= years) {
        var r = t.range[buckets[i]];
        return r ? { min: r[0], max: r[1] } : null;
      }
    }
    return null;
  }

  var GLOSSARY = {
    mix: 'תמהיל משכנתא – חלוקת ההלוואה לכמה מסלולים בעלי מאפיינים שונים (ריבית קבועה/משתנה, צמוד/לא צמוד) כדי לאזן בין עלות לסיכון.',
    cpi: 'מדד המחירים לצרכן – במסלולים צמודים, יתרת הקרן מתעדכנת מדי חודש לפי שינוי המדד. יעד האינפלציה של בנק ישראל הוא 1%–3% בשנה.',
    prime: 'ריבית הפריים = ריבית בנק ישראל + 1.5%. הצעות במסלול פריים ניתנות כמרווח, למשל "פריים מינוס 0.5%".',
    grace: 'גרייס – דחיית תשלומי קרן לתקופה של עד 60 חודשים. בגרייס חלקי משלמים ריבית בלבד; בגרייס מלא לא משלמים דבר והריבית מצטרפת לקרן.',
    rateChange: 'שינוי ריבית עתידי – הדמיית עלייה (או ירידה) בריבית המסלול החל מחודש מסוים, לבדיקת עמידות ההחזר.',
    prepay: 'סילוק עתידי – פירעון חלקי או מלא של המסלול. "קיצור תקופה" שומר על ההחזר ומקצר את ההלוואה; "הורדת החזר" שומר על התקופה ומקטין את ההחזר.',
    effective: 'עלות אפקטיבית שנתית – שיעור העלות השנתי של ההלוואה כולל עמלות חד-פעמיות, מחושב כשיעור תשואה פנימי (IRR) של תזרים התשלומים. במסלולים צמודים מחושב לפי המדד המשוער.',
    perShekel: 'כמה שקלים תחזירו בסך הכול על כל שקל שלוויתם (כולל ריבית והצמדה, ללא עמלות).',
    maxPayment: 'ההחזר החודשי הגבוה ביותר הצפוי לאורך התקופה לפי ההנחות שהוזנו (ללא תשלום בלון וללא סילוקים).',
    pti: 'יחס החזר מהכנסה – ההחזר החודשי כחלק מההכנסה הפנויה. בנק ישראל אוסר על יחס מעל 50%, ומעל 40% נחשב לסיכון מוגבר.',
    ltv: 'שיעור מימון (LTV) – סכום המשכנתא כחלק משווי הנכס. התקרות: 75% לדירה יחידה, 70% למשפרי דיור, 50% לדירה נוספת.',
    indexation: 'החזר הצמדה – הסכום הנוסף שתשלמו בגלל עליית המדד על הקרן במסלולים הצמודים.',
    weightedRate: 'ריבית נומינלית ממוצעת משוקללת לפי סכום כל מסלול (ללא מדד וללא עמלות).'
  };

  return {
    TRACKS: TRACKS,
    TRACK_BY_ID: TRACK_BY_ID,
    METHODS: METHODS,
    PROPERTY_TYPES: PROPERTY_TYPES,
    GLOSSARY: GLOSSARY,
    indicativeRange: indicativeRange,
    MAX_OFFERS: 4,
    MAX_TRACKS: 12,
    MAX_MONTHS: 360,
    MAX_GRACE: 60,
    DEFAULT_PRIME: 6.0,
    DEFAULT_CPI: 2.5
  };
});
