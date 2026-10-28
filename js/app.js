/* UI controller: state, rendering, events, persistence. */
(function () {
  'use strict';

  var D = window.MortgageData, E = window.MortgageEngine, S = window.MortgageShare, C = window.MortgageCharts;
  var esc = C.escapeHtml;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var LS_DRAFT = 'mc.draft', LS_SAVED = 'mc.saved', LS_THEME = 'mc.theme';
  var BANKS = ['בנק הפועלים', 'בנק לאומי', 'מזרחי-טפחות', 'בנק דיסקונט', 'הבינלאומי הראשון', 'בנק ירושלים', 'בנק מרכנתיל', 'יועץ משכנתאות'];

  // ---------- formatting ----------
  var fmtMoney0 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
  var fmtNum0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  var fmtPct = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(v) { return isFinite(v) ? '<bdi class="num">' + fmtMoney0.format(Math.round(v)) + '</bdi>' : '—'; }
  function moneyTxt(v) { return isFinite(v) ? fmtMoney0.format(Math.round(v)) : '—'; }
  function pct(v, digits) { if (!isFinite(v)) return '—'; return '<bdi class="num">' + (digits === 0 ? Math.round(v) : fmtPct.format(v)) + '%</bdi>'; }
  function signedPct(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtPct.format(Math.abs(v)) + '%'; }
  function years(m) {
    m = Number(m);
    if (!(m > 0)) return '';
    var y = Math.floor(m / 12), r = m % 12;
    var ys = y === 1 ? 'שנה' : y === 2 ? 'שנתיים' : y ? y + ' שנים' : '';
    var rs = r === 1 ? 'חודש' : r ? r + ' חודשים' : '';
    return [ys, rs].filter(Boolean).join(' ו-');
  }
  function groupDigits(v) {
    var n = E.num(v, NaN);
    return isFinite(n) && v !== '' ? fmtNum0.format(n) : v;
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------- state ----------
  function newTrack(o) {
    return Object.assign({ type: 'fixed_unlinked', method: 'spitzer', amount: '', months: 300, rate: '', cpi: '',
      advanced: { graceMonths: '', graceType: 'partial', rateChangeMonth: '', rateChangeDelta: '', prepayMonth: '', prepayType: 'partial', prepayAmount: '', prepayMode: 'reduce' } }, o || {});
  }
  function newOffer(name, tracks) {
    return { id: uid(), name: name, notes: '', fees: { oneTime: '', monthly: '' }, tracks: tracks || [newTrack()] };
  }
  function defaultState() {
    // Example mix (1/3 prime, 1/3 fixed unlinked, 1/3 variable-5 linked) so users see results immediately.
    return {
      title: '',
      scenario: { prime: D.DEFAULT_PRIME, cpi: D.DEFAULT_CPI, stressOn: false, stressDelta: 2, stressMonth: 25 },
      borrower: { income: '', propertyValue: '', propertyType: 'single' },
      offers: [newOffer('הצעה 1', [
        newTrack({ type: 'prime', amount: 300000, months: 300, rate: -0.5 }),
        newTrack({ type: 'fixed_unlinked', amount: 300000, months: 300, rate: 4.9 }),
        newTrack({ type: 'var5_linked', amount: 300000, months: 300, rate: 4.2 })
      ])]
    };
  }
  function normalizeState(s) {
    var d = defaultState();
    s.scenario = Object.assign({}, d.scenario, s.scenario || {});
    s.borrower = Object.assign({}, d.borrower, s.borrower || {});
    s.offers = (s.offers || []).slice(0, D.MAX_OFFERS).map(function (o, i) {
      var no = newOffer(o.name || ('הצעה ' + (i + 1)), []);
      no.id = o.id || uid();
      no.notes = o.notes || '';
      no.fees = Object.assign({ oneTime: '', monthly: '' }, o.fees || {});
      no.tracks = (o.tracks || []).slice(0, D.MAX_TRACKS).map(function (t) {
        var nt = newTrack(t);
        nt.advanced = Object.assign(newTrack().advanced, t.advanced || {});
        return nt;
      });
      return no;
    });
    if (!s.offers.length) s.offers = d.offers;
    s.title = s.title || '';
    return s;
  }

  var state = null;
  var ui = { active: 0, currentId: null, dirty: false, shared: false, touched: {}, chart: 'payment', results: [] };

  function scenarioForEngine() {
    var sc = state.scenario;
    return { prime: E.num(sc.prime, D.DEFAULT_PRIME), cpi: E.num(sc.cpi, D.DEFAULT_CPI),
      stressDelta: sc.stressOn ? E.num(sc.stressDelta, 0) : 0, stressMonth: sc.stressOn ? E.num(sc.stressMonth, 0) : 0 };
  }

  // ---------- persistence ----------
  function loadSaved() { try { return JSON.parse(localStorage.getItem(LS_SAVED)) || []; } catch (e) { return []; } }
  function writeSaved(list) { try { localStorage.setItem(LS_SAVED, JSON.stringify(list)); return true; } catch (e) { toast('השמירה נכשלה – אין מספיק מקום בדפדפן'); return false; } }
  var draftTimer = null;
  function markDirty() {
    ui.dirty = true;
    updateSaveStatus();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try { localStorage.setItem(LS_DRAFT, JSON.stringify({ state: state, currentId: ui.currentId, dirty: ui.dirty, active: ui.active })); } catch (e) {}
    }, 300);
  }
  function updateSaveStatus() {
    var el = $('#save-status');
    if (ui.currentId && !ui.dirty) el.textContent = 'נשמר ✓';
    else if (ui.currentId) el.textContent = 'יש שינויים שלא נשמרו';
    else el.textContent = '';
  }
  function saveComparison() {
    var list = loadSaved();
    var title = state.title.trim() || ('השוואה מ-' + new Date().toLocaleDateString('he-IL'));
    if (!state.title.trim()) { state.title = title; $('#comparison-title').value = title; }
    var entry = { id: ui.currentId || uid(), title: title, updated: Date.now(), state: JSON.parse(JSON.stringify(state)) };
    var idx = list.findIndex(function (x) { return x.id === entry.id; });
    if (idx >= 0) list[idx] = entry; else list.unshift(entry);
    if (writeSaved(list)) {
      ui.currentId = entry.id; ui.dirty = false; ui.shared = false;
      hideBanner();
      markDirty(); ui.dirty = false; updateSaveStatus();
      toast('ההשוואה נשמרה במכשיר זה');
    }
  }
  function openSaved(id) {
    var e = loadSaved().find(function (x) { return x.id === id; });
    if (!e) return;
    loadState(normalizeState(JSON.parse(JSON.stringify(e.state))), { currentId: id });
    toast('נפתחה: ' + e.title);
  }
  function loadState(s, opts) {
    state = s;
    ui.active = Math.min((opts && opts.active) || 0, state.offers.length - 1);
    ui.currentId = (opts && opts.currentId) || null;
    ui.dirty = !!(opts && opts.dirty);
    ui.touched = {};
    renderAll();
    markDirty();
    ui.dirty = !!(opts && opts.dirty);
    updateSaveStatus();
  }

  // ---------- toast / banner / popover ----------
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function showBanner(html) { var b = $('#banner'); b.innerHTML = html; b.hidden = false; }
  function hideBanner() { $('#banner').hidden = true; }

  function showPopover(btn) {
    var pop = $('#popover');
    var term = btn.getAttribute('data-term');
    var text = D.GLOSSARY[term] || btn.getAttribute('data-text') || '';
    if (!pop.hidden && pop._owner === btn) { pop.hidden = true; return; }
    pop.textContent = text;
    pop.hidden = false;
    pop._owner = btn;
    var r = btn.getBoundingClientRect();
    var w = Math.min(320, window.innerWidth - 24);
    pop.style.width = w + 'px';
    var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 12), window.innerWidth - w - 12);
    pop.style.left = left + window.scrollX + 'px';
    pop.style.top = r.bottom + window.scrollY + 8 + 'px';
  }

  // ---------- rendering: assumptions ----------
  function renderAssumptions() {
    var sc = state.scenario, b = state.borrower;
    $('#sc-prime').value = sc.prime;
    $('#sc-cpi').value = sc.cpi;
    $('#sc-stress').checked = !!sc.stressOn;
    $('#sc-stress-delta').value = sc.stressDelta;
    $('#sc-stress-month').value = sc.stressMonth;
    $('#b-income').value = groupDigits(b.income);
    $('#b-value').value = groupDigits(b.propertyValue);
    $('#b-type').innerHTML = D.PROPERTY_TYPES.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === b.propertyType ? ' selected' : '') + '>' + p.name + ' (מימון עד ' + Math.round(p.ltv * 100) + '%)</option>';
    }).join('');
    $('#comparison-title').value = state.title;
    updateAssumptionsHint();
  }
  function updateAssumptionsHint() {
    var sc = state.scenario;
    $('#assumptions-hint').textContent = 'פריים ' + sc.prime + '% · מדד ' + sc.cpi + '%' + (sc.stressOn ? ' · מבחן לחץ +' + sc.stressDelta + '%' : '');
    $$('.stress-row input').forEach(function (i) { i.disabled = !sc.stressOn; });
  }

  // ---------- rendering: offer tabs ----------
  function renderTabs() {
    var host = $('#offer-tabs');
    var html = state.offers.map(function (o, i) {
      var sel = i === ui.active;
      return '<button type="button" role="tab" class="offer-tab c' + (i + 1) + '" id="tab-' + i + '" data-tab="' + i + '" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) + '" aria-controls="offer-panel">' +
        '<span class="dot" aria-hidden="true"></span><span class="tab-name">' + esc(o.name || ('הצעה ' + (i + 1))) + '</span>' +
        '<span class="tab-sub" data-tab-sub="' + i + '"></span></button>';
    }).join('');
    if (state.offers.length < D.MAX_OFFERS) {
      html += '<button type="button" class="offer-tab add" id="btn-add-offer"><span aria-hidden="true">＋</span> הוספת הצעה <small>(' + state.offers.length + '/4)</small></button>';
    }
    host.innerHTML = html;
  }

  // ---------- rendering: offer panel ----------
  function trackTypeOptions(sel) {
    var groups = { fixed: 'ריבית קבועה', variable: 'ריבית משתנה' };
    return Object.keys(groups).map(function (k) {
      return '<optgroup label="' + groups[k] + '">' + D.TRACKS.filter(function (t) { return t.kind === k; }).map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + t.name + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function methodOptions(sel) {
    return D.METHODS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === sel ? ' selected' : '') + '>' + m.name + '</option>'; }).join('');
  }

  function field(o) {
    // o: { id, label, key, value, suffix, help, info, mode, money, list, placeholder, cls, adv }
    var dk = o.adv ? 'data-adv="' + o.key + '"' : 'data-key="' + o.key + '"';
    var input = '<input id="' + o.id + '" ' + dk + ' value="' + esc(o.value === undefined ? '' : o.value) + '" inputmode="' + (o.mode || 'decimal') + '" dir="ltr"' +
      (o.money ? ' data-money' : '') + (o.list ? ' list="' + o.list + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
      ' aria-describedby="' + o.id + '-err ' + o.id + '-help" autocomplete="off">';
    var info = o.info ? ' <button type="button" class="info" ' + (D.GLOSSARY[o.info] ? 'data-term="' + o.info + '"' : 'data-text="' + esc(o.infoText || '') + '"') + ' aria-label="הסבר">i</button>' : '';
    return '<div class="field ' + (o.cls || '') + '"><label for="' + o.id + '">' + o.label + info + '</label>' +
      (o.suffix ? '<div class="input-suffix">' + input + '<span>' + o.suffix + '</span></div>' : input) +
      '<small class="help" id="' + o.id + '-help">' + (o.help || '') + '</small>' +
      '<small class="err" id="' + o.id + '-err" role="alert"></small></div>';
  }

  function advCount(a) {
    return (a.graceMonths ? 1 : 0) + (a.rateChangeMonth ? 1 : 0) + (a.prepayMonth ? 1 : 0);
  }

  function renderTrack(t, ti) {
    var td = D.TRACK_BY_ID[t.type] || D.TRACK_BY_ID.fixed_unlinked;
    var p = 'o' + ui.active + 't' + ti;
    var a = t.advanced;
    var isPrime = td.rateMode === 'prime';
    var durList = td.durations ? 'dl-' + td.id : 'dl-any';
    var html = '<article class="track" data-track="' + ti + '" aria-label="מסלול ' + (ti + 1) + '">' +
      '<header class="track-head">' +
        '<span class="track-num" aria-hidden="true">' + (ti + 1) + '</span>' +
        '<div class="field type-field"><label for="' + p + '-type">מסלול <button type="button" class="info" data-text="' + esc(td.desc) + '" aria-label="הסבר על המסלול">i</button></label>' +
          '<select id="' + p + '-type" data-key="type">' + trackTypeOptions(t.type) + '</select></div>' +
        '<div class="field"><label for="' + p + '-method">שיטת החזר <button type="button" class="info" data-text="' + esc(D.METHODS.map(function (m) { return m.name + ': ' + m.desc; }).join('\n\n')) + '" aria-label="הסבר על שיטות החזר">i</button></label>' +
          '<select id="' + p + '-method" data-key="method">' + methodOptions(t.method) + '</select></div>' +
        '<div class="track-tags">' + (td.kind === 'fixed' ? '<span class="tag fixed">קבועה</span>' : '<span class="tag var">משתנה</span>') + (td.linked ? '<span class="tag linked">צמודה</span>' : '') + '</div>' +
        '<div class="track-actions">' +
          '<button type="button" class="btn btn-icon sm" data-action="dup-track" aria-label="שכפול מסלול" title="שכפול מסלול"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h12v12H8zM4 4h12v2H6v10H4z"/></svg></button>' +
          '<button type="button" class="btn btn-icon sm danger" data-action="del-track" aria-label="מחיקת מסלול" title="מחיקת מסלול"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 14H7zM9 3h6l1 2h4v2H4V5h4z"/></svg></button>' +
        '</div>' +
      '</header>' +
      '<div class="track-grid">' +
        field({ id: p + '-amount', label: 'סכום', key: 'amount', value: groupDigits(t.amount), suffix: '₪', mode: 'numeric', money: true, placeholder: '300,000' }) +
        field({ id: p + '-months', label: 'תקופה (חודשים)', key: 'months', value: t.months, mode: 'numeric', list: durList, help: years(t.months), placeholder: '300' }) +
        field({ id: p + '-rate', label: isPrime ? 'מרווח מהפריים' : 'ריבית שנתית', key: 'rate', value: t.rate, suffix: '%', info: isPrime ? 'prime' : null,
          placeholder: isPrime ? '-0.5' : '4.5', help: '' }) +
        (td.linked ? field({ id: p + '-cpi', label: 'מדד שנתי', key: 'cpi', value: t.cpi, suffix: '%', info: 'cpi', placeholder: String(state.scenario.cpi), help: t.cpi === '' ? 'לפי ההנחה הכללית' : '' }) : '<div class="field muted-field"><span class="label-like">מדד</span><span class="na">לא צמוד</span></div>') +
      '</div>' +
      '<div class="track-result" aria-live="polite">' +
        '<div><span>החזר חודשי ראשון</span><strong data-r="first">—</strong></div>' +
        '<div><span>החזר מקסימלי</span><strong data-r="max">—</strong></div>' +
        '<div><span>סך החזר במסלול</span><strong data-r="total">—</strong></div>' +
      '</div>' +
      '<details class="adv"' + (advCount(a) ? ' open' : '') + '>' +
        '<summary>אפשרויות מתקדמות <span class="adv-count">' + (advCount(a) ? advCount(a) + ' פעילות' : 'גרייס · שינוי ריבית · סילוק מוקדם') + '</span></summary>' +
        '<div class="adv-grid">' +
          '<fieldset><legend>גרייס <button type="button" class="info" data-term="grace" aria-label="מה זה גרייס?">i</button></legend>' +
            field({ id: p + '-grace', label: 'משך (חודשים, עד 60)', key: 'graceMonths', adv: true, value: a.graceMonths, mode: 'numeric', placeholder: '0' }) +
            '<div class="field"><label for="' + p + '-gtype">סוג</label><select id="' + p + '-gtype" data-adv="graceType"><option value="partial"' + (a.graceType !== 'full' ? ' selected' : '') + '>חלקי – ריבית בלבד</option><option value="full"' + (a.graceType === 'full' ? ' selected' : '') + '>מלא – ללא תשלום</option></select></div>' +
          '</fieldset>' +
          '<fieldset><legend>שינוי ריבית עתידי <button type="button" class="info" data-term="rateChange" aria-label="הסבר">i</button></legend>' +
            field({ id: p + '-rcm', label: 'החל מחודש', key: 'rateChangeMonth', adv: true, value: a.rateChangeMonth, mode: 'numeric', placeholder: '61' }) +
            field({ id: p + '-rcd', label: 'שינוי (נק׳ אחוז)', key: 'rateChangeDelta', adv: true, value: a.rateChangeDelta, suffix: '%', placeholder: '+1.5' }) +
            (td.kind === 'fixed' ? '<small class="help warn-text">במסלול קבוע הריבית לא משתנה בפועל – השתמשו בכך רק לבדיקת תרחיש.</small>' : '') +
          '</fieldset>' +
          '<fieldset><legend>סילוק עתידי <button type="button" class="info" data-term="prepay" aria-label="הסבר">i</button></legend>' +
            '<div class="field"><label for="' + p + '-ptype">סוג סילוק</label><select id="' + p + '-ptype" data-adv="prepayType"><option value="partial"' + (a.prepayType !== 'full' ? ' selected' : '') + '>סילוק חלקי</option><option value="full"' + (a.prepayType === 'full' ? ' selected' : '') + '>סילוק מלא</option></select></div>' +
            field({ id: p + '-pm', label: 'בחודש', key: 'prepayMonth', adv: true, value: a.prepayMonth, mode: 'numeric', placeholder: '60' }) +
            (a.prepayType === 'full' ? '<div class="field"><span class="label-like">סכום</span><span class="na" data-r="payoff">כל היתרה</span></div>'
              : field({ id: p + '-pa', label: 'סכום', key: 'prepayAmount', adv: true, value: groupDigits(a.prepayAmount), suffix: '₪', mode: 'numeric', money: true, placeholder: '50,000' })) +
            (a.prepayType === 'full' ? '' : '<div class="field"><label for="' + p + '-pmode">אחרי הסילוק</label><select id="' + p + '-pmode" data-adv="prepayMode"' + (t.method === 'bullet' ? ' disabled' : '') + '><option value="reduce"' + (a.prepayMode !== 'shorten' ? ' selected' : '') + '>הקטנת ההחזר החודשי</option><option value="shorten"' + (a.prepayMode === 'shorten' ? ' selected' : '') + '>קיצור התקופה</option></select></div>') +
            '<small class="help">לא כולל עמלת פירעון מוקדם.</small>' +
          '</fieldset>' +
        '</div>' +
      '</details>' +
    '</article>';
    return html;
  }

  function renderPanel() {
    var o = state.offers[ui.active];
    var i = ui.active;
    var html = '<div class="offer-head c' + (i + 1) + '">' +
      '<div class="field offer-name-field"><label for="offer-name">שם ההצעה</label>' +
        '<div class="name-wrap"><span class="dot" aria-hidden="true"></span><input id="offer-name" data-offer="name" value="' + esc(o.name) + '" maxlength="40" list="dl-banks" placeholder="למשל: בנק הפועלים"><svg class="pencil" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.3V21h3.7L18 9.7 14.3 6zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8L19 8.8z"/></svg></div></div>' +
      '<div class="offer-actions">' +
        (state.offers.length < D.MAX_OFFERS ? '<button type="button" class="btn" data-action="dup-offer">שכפול הצעה</button>' : '') +
        (state.offers.length > 1 ? '<button type="button" class="btn danger" data-action="del-offer">מחיקת הצעה</button>' : '') +
      '</div></div>' +
      '<div class="tracks">' + o.tracks.map(renderTrack).join('') + '</div>' +
      '<div class="tracks-foot">' +
        (o.tracks.length < D.MAX_TRACKS ? '<button type="button" class="btn btn-add" data-action="add-track">＋ הוספת מסלול</button>' : '<span class="muted">ניתן להגדיר עד 12 מסלולים</span>') +
        '<span class="mix-total" id="mix-total"></span>' +
      '</div>' +
      '<details class="fees"' + (o.fees.oneTime || o.fees.monthly || o.notes ? ' open' : '') + '><summary>עמלות והערות להצעה (רשות)</summary>' +
        '<div class="grid-assume">' +
          '<div class="field"><label for="fee-one">עמלות חד-פעמיות <button type="button" class="info" data-text="עמלת פתיחת תיק, שמאות, רישום משכנתא וכדומה. משפיעות על העלות האפקטיבית ועל סך העלות." aria-label="הסבר">i</button></label><div class="input-suffix"><input id="fee-one" data-fee="oneTime" value="' + esc(groupDigits(o.fees.oneTime)) + '" inputmode="numeric" dir="ltr" data-money placeholder="0"><span>₪</span></div></div>' +
          '<div class="field"><label for="fee-month">עמלה חודשית <button type="button" class="info" data-text="דמי ניהול חודשיים או עלות קבועה אחרת שהבנק גובה (ביטוחים אפשר להוסיף כאן להשוואה כוללת)." aria-label="הסבר">i</button></label><div class="input-suffix"><input id="fee-month" data-fee="monthly" value="' + esc(groupDigits(o.fees.monthly)) + '" inputmode="numeric" dir="ltr" data-money placeholder="0"><span>₪</span></div></div>' +
          '<div class="field wide"><label for="offer-notes">הערות</label><input id="offer-notes" data-offer="notes" value="' + esc(o.notes) + '" maxlength="200" placeholder="למשל: הצעה בתוקף עד 15/11, כולל הנחה בעמלת פתיחת תיק"></div>' +
        '</div></details>' +
      '<div class="offer-summary" id="offer-summary" aria-live="polite"></div>';
    $('#offer-panel').innerHTML = html;
    $('#offer-panel').setAttribute('aria-labelledby', 'tab-' + i);
  }

  function renderDatalists() {
    var html = '<datalist id="dl-banks">' + BANKS.map(function (b) { return '<option value="' + b + '">'; }).join('') + '</datalist>';
    html += '<datalist id="dl-any">' + [60, 120, 180, 240, 300, 360].map(function (m) { return '<option value="' + m + '">' + years(m) + '</option>'; }).join('') + '</datalist>';
    D.TRACKS.forEach(function (t) {
      if (t.durations) html += '<datalist id="dl-' + t.id + '">' + t.durations.map(function (m) { return '<option value="' + m + '">' + years(m) + '</option>'; }).join('') + '</datalist>';
    });
    var host = document.createElement('div');
    host.hidden = true;
    host.innerHTML = html;
    document.body.appendChild(host);
  }

  function renderAll() {
    renderAssumptions();
    renderTabs();
    renderPanel();
    recalc();
  }

  // ---------- recalculation & result rendering ----------
  var rafPending = false;
  function scheduleRecalc() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; recalc(); });
  }

  function recalc() {
    var sc = scenarioForEngine();
    ui.results = state.offers.map(function (o) { return E.computeOffer(o, sc, state.borrower); });
    updateTrackResults();
    updateOfferSummary();
    updateTabSubs();
    renderComparison();
  }

  function setFieldError(input, msg, soft) {
    if (!input) return;
    var err = document.getElementById(input.id + '-err');
    input.setAttribute('aria-invalid', msg && !soft ? 'true' : 'false');
    input.classList.toggle('soft', !!(msg && soft));
    if (err) { err.textContent = msg || ''; err.classList.toggle('soft', !!soft); }
  }

  function updateTrackResults() {
    var res = ui.results[ui.active];
    var o = state.offers[ui.active];
    var sc = scenarioForEngine();
    $$('#offer-panel .track').forEach(function (card) {
      var ti = Number(card.getAttribute('data-track'));
      var item = res.tracks[ti];
      var t = o.tracks[ti];
      var td = D.TRACK_BY_ID[t.type];
      // errors
      var errMap = {};
      item.errors.forEach(function (e) { if (!errMap[e.field]) errMap[e.field] = e; });
      $$('input[data-key],input[data-adv],select[data-adv]', card).forEach(function (inp) {
        var key = inp.getAttribute('data-key') || inp.getAttribute('data-adv');
        var e = errMap[key];
        var touched = ui.touched[inp.id] || (inp.value !== '' && key !== 'amount');
        setFieldError(inp, e && (touched || e.soft) ? e.msg : '', e && e.soft);
      });
      // rate hint
      var rateHelp = document.getElementById(card.querySelector('[data-key="rate"]').id + '-help');
      var rng = D.indicativeRange(t.type, E.num(t.months, 0));
      var rate = E.num(t.rate, NaN);
      var hint = '';
      if (td.rateMode === 'prime' && isFinite(rate)) hint = 'ריבית בפועל: ' + fmtPct.format(sc.prime + rate) + '%';
      if (rng) {
        var rtxt = td.rateMode === 'prime' ? 'פריים ' + signedPct(rng.min) + ' עד ' + signedPct(rng.max) : fmtPct.format(rng.min) + '%–' + fmtPct.format(rng.max) + '%';
        var out = isFinite(rate) && (rate < rng.min - 1e-9 || rate > rng.max + 1e-9);
        hint += (hint ? ' · ' : '') + '<span class="' + (out ? 'warn-text' : '') + '" title="טווח אינדיקטיבי בלבד">טווח מקובל: <bdi>' + rtxt + '</bdi>' + (out ? (rate > rng.max ? ' (מעל הטווח)' : ' (מתחת לטווח)') : '') + '</span>';
      }
      rateHelp.innerHTML = hint;
      var mh = document.getElementById(card.querySelector('[data-key="months"]').id + '-help');
      if (mh) mh.textContent = years(t.months);
      // results
      var s = item.schedule && item.schedule.summary;
      card.querySelector('[data-r="first"]').innerHTML = s ? money(s.firstPayment) : '—';
      card.querySelector('[data-r="max"]').innerHTML = s ? money(s.maxPayment) : '—';
      card.querySelector('[data-r="total"]').innerHTML = s ? money(s.totalPaid) : '—';
      var po = card.querySelector('[data-r="payoff"]');
      if (po && item.schedule) {
        var pr = item.schedule.rows.filter(function (r) { return r.prepay > 0; })[0];
        po.innerHTML = pr ? 'כל היתרה: ' + money(pr.prepay) : 'כל היתרה';
      }
      card.classList.toggle('invalid', !item.schedule);
    });
    var total = o.tracks.reduce(function (a, t) { return a + E.num(t.amount, 0); }, 0);
    var mt = $('#mix-total');
    if (mt) mt.innerHTML = 'סה״כ בתמהיל: ' + money(total);
  }

  function summaryItems(s) {
    return [
      { label: 'סך ההלוואה', val: money(s.amount) },
      { label: 'החזר חודשי ראשון', val: money(s.firstPayment), strong: true },
      { label: 'החזר מקסימלי', val: money(s.maxPayment), sub: s.maxPaymentMonth > 1 ? 'בחודש ' + s.maxPaymentMonth + ' (' + years(s.maxPaymentMonth) + ')' : '', term: 'maxPayment' },
      { label: 'סך ריבית', val: money(s.totalInterest) },
      { label: 'סך הצמדה למדד', val: money(s.totalIndexation), term: 'indexation' },
      { label: 'עמלות', val: money(s.feesTotal) },
      { label: 'סך כל התשלומים', val: money(s.totalCost), strong: true, sub: s.feesTotal ? 'כולל עמלות' : '' },
      { label: 'עבור כל ₪1 תחזירו', val: '<bdi class="num">' + fmtPct.format(s.perShekel).replace('%', '') + ' ₪</bdi>', term: 'perShekel' },
      { label: 'ריבית ממוצעת משוקללת', val: pct(s.weightedRate), term: 'weightedRate' },
      { label: 'עלות אפקטיבית שנתית', val: pct(s.effectiveRate), term: 'effective' },
      { label: 'תקופה', val: years(s.months) }
    ];
  }

  function compositionBar(s) {
    var f = Math.round(s.fixedShare * 100), l = Math.round(s.linkedShare * 100);
    return '<div class="composition"><div class="comp-row"><span>קבועה ' + f + '%</span><div class="comp-bar" role="img" aria-label="קבועה ' + f + '%, משתנה ' + (100 - f) + '%"><span class="cf" style="width:' + f + '%"></span><span class="cv" style="width:' + (100 - f) + '%"></span></div><span>משתנה ' + (100 - f) + '%</span></div>' +
      '<div class="comp-row"><span>צמודה ' + l + '%</span><div class="comp-bar" role="img" aria-label="צמודה ' + l + '%"><span class="cl" style="width:' + l + '%"></span><span class="cu" style="width:' + (100 - l) + '%"></span></div><span>לא צמודה ' + (100 - l) + '%</span></div></div>';
  }

  function updateOfferSummary() {
    var host = $('#offer-summary');
    if (!host) return;
    var res = ui.results[ui.active];
    if (!res.summary) { host.innerHTML = '<p class="empty">מלאו לפחות מסלול אחד (סכום, תקופה וריבית) כדי לראות את סיכום התמהיל.</p>'; return; }
    var s = res.summary;
    host.innerHTML = '<div class="summary-head"><h3>סיכום התמהיל – ' + esc(state.offers[ui.active].name) + '</h3>' +
      '<button type="button" class="btn btn-primary" data-action="schedule">לוח סילוקין מלא</button></div>' +
      '<div class="summary-grid">' + summaryItems(s).map(function (it) {
        return '<div class="sum-item' + (it.strong ? ' strong' : '') + '"><span class="sum-label">' + it.label + (it.term ? ' <button type="button" class="info" data-term="' + it.term + '" aria-label="הסבר">i</button>' : '') + '</span><span class="sum-val">' + it.val + '</span>' + (it.sub ? '<span class="sum-sub">' + it.sub + '</span>' : '') + '</div>';
      }).join('') + '</div>' + compositionBar(s) +
      (s.pti !== undefined ? '<p class="muted small">יחס החזר מהכנסה: ' + pct(s.pti * 100, 0) + ' בתחילה, עד ' + pct(s.ptiMax * 100, 0) + ' בשיא. <button type="button" class="info" data-term="pti" aria-label="הסבר">i</button></p>' : '') +
      (s.ltv !== undefined ? '<p class="muted small">שיעור מימון: ' + pct(s.ltv * 100, 0) + ' <button type="button" class="info" data-term="ltv" aria-label="הסבר">i</button></p>' : '') +
      (res.warnings.length ? '<ul class="warnings">' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
  }

  function updateTabSubs() {
    ui.results.forEach(function (r, i) {
      var el = document.querySelector('[data-tab-sub="' + i + '"]');
      if (el) el.innerHTML = r.summary ? money(r.summary.firstPayment) + '/חודש' : 'לא הושלם';
    });
  }

  // ---------- comparison ----------
  var METRICS = [
    { key: 'amount', label: 'סך ההלוואה', fmt: money, better: null },
    { key: 'months', label: 'תקופה מקסימלית', fmt: function (v) { return years(v); }, better: null },
    { key: 'firstPayment', label: 'החזר חודשי ראשון', fmt: money, better: 'low' },
    { key: 'payment5y', label: 'החזר צפוי אחרי 5 שנים', fmt: money, better: 'low' },
    { key: 'maxPayment', label: 'החזר מקסימלי', fmt: money, better: 'low', term: 'maxPayment' },
    { key: 'weightedRate', label: 'ריבית ממוצעת משוקללת', fmt: function (v) { return pct(v); }, better: 'low', term: 'weightedRate' },
    { key: 'effectiveRate', label: 'עלות אפקטיבית שנתית', fmt: function (v) { return pct(v); }, better: 'low', term: 'effective' },
    { key: 'totalInterest', label: 'סך ריבית', fmt: money, better: 'low' },
    { key: 'totalIndexation', label: 'סך הצמדה למדד', fmt: money, better: 'low', term: 'indexation' },
    { key: 'feesTotal', label: 'עמלות', fmt: money, better: 'low' },
    { key: 'totalCost', label: 'סך כל התשלומים', fmt: money, better: 'low', key2: true },
    { key: 'perShekel', label: 'עבור כל ₪1', fmt: function (v) { return '<bdi class="num">' + fmtPct.format(v) + ' ₪</bdi>'; }, better: 'low', term: 'perShekel' },
    { key: 'balance5y', label: 'יתרה לסילוק אחרי 5 שנים', fmt: money, better: 'low' },
    { key: 'fixedShare', label: 'חלק בריבית קבועה', fmt: function (v) { return pct(v * 100, 0); }, better: null },
    { key: 'linkedShare', label: 'חלק צמוד למדד', fmt: function (v) { return pct(v * 100, 0); }, better: null }
  ];

  function diffText(v, best, m) {
    if (m.key === 'weightedRate' || m.key === 'effectiveRate') return '+' + fmtPct.format(v - best) + '%';
    if (m.key === 'perShekel') return '+' + fmtPct.format(v - best) + ' ₪';
    return '+' + moneyTxt(v - best);
  }

  function renderComparison() {
    var host = $('#compare');
    var items = state.offers.map(function (o, i) { return { offer: o, idx: i, res: ui.results[i] }; }).filter(function (x) { return x.res.summary; });
    if (!items.length) { host.innerHTML = '<p class="empty">ההשוואה תופיע כאן לאחר שתמלאו לפחות הצעה אחת.</p>'; return; }
    var single = items.length === 1;
    var amounts = items.map(function (x) { return x.res.summary.amount; });
    var amountsDiffer = Math.max.apply(null, amounts) - Math.min.apply(null, amounts) > 0.005 * Math.max.apply(null, amounts);

    var html = '';
    if (single) {
      html += '<div class="callout">הוסיפו הצעה נוספת (עד 4) כדי להשוות. טיפ: ״שכפול הצעה״ מעתיק את התמהיל ומאפשר לשנות רק את הריביות שקיבלתם מבנק אחר.</div>';
    } else {
      html += renderInsights(items, amountsDiffer);
    }

    // table
    html += '<div class="table-wrap compare-wrap"><table class="compare-table"><caption class="sr-only">השוואת הצעות</caption><thead><tr><th scope="col">מדד</th>' +
      items.map(function (x) { return '<th scope="col" class="c' + (x.idx + 1) + '"><span class="dot" aria-hidden="true"></span>' + esc(x.offer.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
    METRICS.forEach(function (m) {
      var vals = items.map(function (x) { return x.res.summary[m.key]; });
      var best = null;
      if (!single && m.better) {
        var fin = vals.filter(isFinite);
        best = fin.length ? Math.min.apply(null, fin) : null;
        var worst = fin.length ? Math.max.apply(null, fin) : null;
        if (best !== null && Math.abs(worst - best) < 0.5 && m.key !== 'weightedRate' && m.key !== 'effectiveRate' && m.key !== 'perShekel') best = null;
        if (best !== null && Math.abs(worst - best) < 0.005) best = null;
        if (m.key === 'totalIndexation' && best === 0 && worst === 0) best = null;
      }
      html += '<tr' + (m.key2 ? ' class="key-row"' : '') + '><th scope="row">' + m.label + (m.term ? ' <button type="button" class="info" data-term="' + m.term + '" aria-label="הסבר">i</button>' : '') + '</th>' +
        vals.map(function (v) {
          var isBest = best !== null && isFinite(v) && Math.abs(v - best) < 1e-9;
          var diff = best !== null && isFinite(v) && !isBest ? '<small class="diff">' + diffText(v, best, m) + '</small>' : '';
          return '<td class="' + (isBest ? 'best' : '') + '">' + m.fmt(v) + (isBest ? '<span class="badge">הנמוך ביותר</span>' : '') + diff + '</td>';
        }).join('') + '</tr>';
    });
    html += '<tr><th scope="row">פעולות</th>' + items.map(function (x) {
      return '<td><button type="button" class="btn sm" data-action="schedule" data-offer-idx="' + x.idx + '">לוח סילוקין</button> <button type="button" class="btn sm btn-ghost" data-action="goto-offer" data-offer-idx="' + x.idx + '">עריכה</button></td>';
    }).join('') + '</tr>';
    html += '</tbody></table></div>';

    // charts
    html += '<div class="chart-card"><div class="seg" role="tablist" aria-label="גרף">' +
      [['payment', 'החזר חודשי לאורך זמן'], ['balance', 'יתרת ההלוואה'], ['cost', 'הרכב העלות']].map(function (c) {
        return '<button type="button" role="tab" data-chart="' + c[0] + '" aria-selected="' + (ui.chart === c[0]) + '">' + c[1] + '</button>';
      }).join('') + '</div><div id="chart" class="chart"></div><div class="legend" id="chart-legend"></div></div>';

    // yearly table
    html += '<details class="yearly"><summary>לוח שנתי משווה – החזר חודשי ויתרה בתחילת כל שנה</summary><div class="table-wrap">' + yearlyCompareTable(items) + '</div></details>';
    host.innerHTML = html;
    drawChart(items);
  }

  function renderInsights(items, amountsDiffer) {
    function minBy(key) {
      var sorted = items.slice().sort(function (a, b) { return a.res.summary[key] - b.res.summary[key]; });
      return { best: sorted[0], next: sorted[1] };
    }
    var costKey = amountsDiffer ? 'perShekel' : 'totalCost';
    var c = minBy(costKey), f = minBy('firstPayment'), mx = minBy('maxPayment');
    function card(title, r, key, fmtDiff, extra) {
      var d = r.next.res.summary[key] - r.best.res.summary[key];
      var same = Math.abs(d) < (key === 'perShekel' ? 0.005 : 1);
      return '<div class="insight c' + (r.best.idx + 1) + '"><span class="ins-title">' + title + '</span>' +
        (same ? '<strong>אין הבדל משמעותי</strong>' : '<strong><span class="dot" aria-hidden="true"></span>' + esc(r.best.offer.name) + '</strong><span class="ins-sub">' + fmtDiff(d) + ' פחות מ' + esc(r.next.offer.name) + (extra || '') + '</span>') + '</div>';
    }
    var html = '<div class="insights">' +
      card(amountsDiffer ? 'העלות הנמוכה ביותר לכל ₪1' : 'סך התשלומים הנמוך ביותר', c, costKey, function (d) { return amountsDiffer ? '<bdi>' + fmtPct.format(d) + ' ₪</bdi> לכל שקל' : money(d); }) +
      card('ההחזר החודשי הראשון הנמוך ביותר', f, 'firstPayment', function (d) { return money(d) + ' בחודש'; }) +
      card('ההחזר המקסימלי הנמוך ביותר', mx, 'maxPayment', function (d) { return money(d) + ' בחודש'; }) +
      '</div>';
    var notes = [];
    if (amountsDiffer) notes.push('סכומי ההלוואה בהצעות שונים, ולכן ההשוואה העיקרית היא לפי העלות לכל שקל שלוויתם.');
    var varShares = items.map(function (x) { return x.res.summary.variableShare; });
    if (Math.max.apply(null, varShares) - Math.min.apply(null, varShares) > 0.1) notes.push('להצעות רמת סיכון שונה: חלק הריבית המשתנה נע בין ' + Math.round(Math.min.apply(null, varShares) * 100) + '% ל-' + Math.round(Math.max.apply(null, varShares) * 100) + '%. הצעה זולה יותר בהנחות הנוכחיות עלולה להתייקר אם הריבית תעלה – נסו את ״מבחן הלחץ״ בהנחות הכלליות.');
    var lens = items.map(function (x) { return x.res.summary.months; });
    if (Math.max.apply(null, lens) !== Math.min.apply(null, lens)) notes.push('תקופות ההלוואה שונות: תקופה ארוכה מקטינה את ההחזר החודשי אך מגדילה את סך התשלומים.');
    if (items.some(function (x) { return x.res.summary.linkedShare > 0; })) notes.push('בהצעות עם מסלולים צמודים, סך התשלומים תלוי במדד שהנחתם (' + state.scenario.cpi + '% בשנה כברירת מחדל).');
    if (notes.length) html += '<ul class="notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    return html;
  }

  function yearlyCompareTable(items) {
    var maxYears = Math.max.apply(null, items.map(function (x) { return Math.ceil(x.res.rows.length / 12); }));
    var h = '<table class="data-table"><thead><tr><th rowspan="2">שנה</th>' + items.map(function (x) { return '<th colspan="2" class="c' + (x.idx + 1) + '"><span class="dot"></span>' + esc(x.offer.name) + '</th>'; }).join('') + '</tr><tr>' +
      items.map(function () { return '<th>החזר חודשי</th><th>יתרה</th>'; }).join('') + '</tr></thead><tbody>';
    for (var y = 0; y < maxYears; y++) {
      h += '<tr><th>' + (y + 1) + '</th>' + items.map(function (x) {
        var r = x.res.rows[y * 12];
        return r ? '<td>' + money(r.regular - r.balloon) + '</td><td>' + money(r.opening + r.indexation) + '</td>' : '<td>—</td><td>—</td>';
      }).join('') + '</tr>';
    }
    return h + '</tbody></table>';
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawChart(items) {
    var host = $('#chart');
    if (!host) return;
    var legend = $('#chart-legend');
    var colors = items.map(function (x) { return cssVar('--c' + (x.idx + 1)); });
    legend.innerHTML = ui.chart === 'cost' ? '' : items.map(function (x, i) { return '<span><i style="background:' + colors[i] + '"></i>' + esc(x.offer.name) + '</span>'; }).join('');
    if (ui.chart === 'cost') {
      C.stacked(host, {
        format: moneyTxt,
        items: items.map(function (x, i) {
          var s = x.res.summary;
          return { name: x.offer.name, color: colors[i], parts: [
            { label: 'קרן', value: s.amount, cls: 'p-principal' },
            { label: 'ריבית', value: s.totalInterest, cls: 'p-interest' },
            { label: 'הצמדה', value: s.totalIndexation, cls: 'p-index' },
            { label: 'עמלות', value: s.feesTotal, cls: 'p-fees' }
          ] };
        })
      });
      return;
    }
    var key = ui.chart === 'payment' ? 'regular' : 'closing';
    C.line(host, {
      label: ui.chart === 'payment' ? 'החזר חודשי לאורך זמן' : 'יתרת ההלוואה לאורך זמן',
      height: window.innerWidth < 600 ? 220 : 280,
      xFormat: function (m) { return 'שנה ' + Math.ceil(m / 12); },
      xTip: function (m) { return 'חודש ' + m + ' (שנה ' + Math.ceil(m / 12) + ')'; },
      tipFormat: moneyTxt,
      series: items.map(function (x, i) {
        return { name: x.offer.name, color: colors[i], points: x.res.rows.map(function (r) { return { x: r.month, y: key === 'regular' ? r.regular - r.balloon : r.closing }; }) };
      })
    });
  }

  // ---------- amortization dialog ----------
  var sched = { offer: 0, track: 'all', view: 'yearly' };
  function openSchedule(idx) {
    sched.offer = idx; sched.track = 'all';
    var o = state.offers[idx], res = ui.results[idx];
    $('#schedule-title').textContent = 'לוח סילוקין – ' + o.name;
    var opts = '<option value="all">כל התמהיל</option>' + res.tracks.map(function (t, i) {
      return t.schedule ? '<option value="' + i + '">מסלול ' + (i + 1) + ' – ' + D.TRACK_BY_ID[t.track.type].short + ' (' + moneyTxt(t.schedule.params.amount) + ')</option>' : '';
    }).join('');
    $('#schedule-track').innerHTML = opts;
    renderSchedule();
    $('#schedule-dialog').showModal();
  }
  function currentScheduleRows() {
    var res = ui.results[sched.offer];
    if (sched.track === 'all') return { rows: res.rows, summary: res.summary };
    var t = res.tracks[Number(sched.track)];
    return { rows: t.schedule.rows, summary: t.schedule.summary };
  }
  function renderSchedule() {
    var cur = currentScheduleRows();
    var s = cur.summary;
    $('#schedule-summary').innerHTML = [
      ['סך ההלוואה', money(s.amount)], ['החזר ראשון', money(s.firstPayment)], ['החזר מקסימלי', money(s.maxPayment)],
      ['סך ריבית', money(s.totalInterest)], ['סך הצמדה', money(s.totalIndexation)], ['סך תשלומים', money(s.totalPaid)]
    ].map(function (x) { return '<div><span>' + x[0] + '</span><strong>' + x[1] + '</strong></div>'; }).join('');
    $$('#schedule-dialog [data-view]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === sched.view)); });
    var h;
    if (sched.view === 'yearly') {
      var ys = E.yearly(cur.rows);
      h = '<table class="data-table"><thead><tr><th>שנה</th><th>יתרת פתיחה</th><th>החזר חודשי (ראשון בשנה)</th><th>קרן</th><th>ריבית</th><th>הצמדה</th><th>סילוק</th><th>סך תשלומים בשנה</th><th>יתרת סגירה</th></tr></thead><tbody>' +
        ys.map(function (y) {
          return '<tr><th>' + y.year + '</th><td>' + money(y.opening) + '</td><td>' + money(y.firstPayment) + '</td><td>' + money(y.principal) + '</td><td>' + money(y.interest) + '</td><td>' + money(y.indexation) + '</td><td>' + (y.prepay ? money(y.prepay) : '—') + '</td><td>' + money(y.payment) + '</td><td>' + money(y.closing) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      h = '<table class="data-table"><thead><tr><th>חודש</th><th>יתרת פתיחה</th><th>הצמדה</th><th>קרן</th><th>ריבית</th><th>החזר חודשי</th><th>סילוק</th><th>יתרת סגירה</th></tr></thead><tbody>' +
        cur.rows.map(function (r) {
          return '<tr><th>' + r.month + '</th><td>' + money(r.opening) + '</td><td>' + money(r.indexation) + '</td><td>' + money(r.principal) + '</td><td>' + money(r.interest) + '</td><td>' + money(r.regular) + '</td><td>' + (r.prepay ? money(r.prepay) : '—') + '</td><td>' + money(r.closing) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    $('#schedule-table').innerHTML = h;
  }
  function exportCsv() {
    var cur = currentScheduleRows();
    var lines = [['חודש', 'ריבית שנתית %', 'יתרת פתיחה', 'הצמדה', 'קרן', 'ריבית', 'החזר חודשי', 'סילוק', 'יתרת סגירה'].join(',')];
    cur.rows.forEach(function (r) {
      lines.push([r.month, r.rate !== undefined ? r.rate.toFixed(3) : '', r.opening.toFixed(2), r.indexation.toFixed(2), r.principal.toFixed(2), r.interest.toFixed(2), r.regular.toFixed(2), r.prepay.toFixed(2), r.closing.toFixed(2)].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'לוח-סילוקין-' + (state.offers[sched.offer].name || 'הצעה').replace(/[\\/:*?"<>|]/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- library dialog ----------
  function renderLibrary() {
    var list = loadSaved();
    var host = $('#library-list');
    if (!list.length) { host.innerHTML = '<p class="empty">עדיין לא שמרתם השוואות. לחצו ״שמירה״ כדי לשמור את ההשוואה הנוכחית במכשיר זה.</p>'; return; }
    host.innerHTML = '<ul class="lib">' + list.map(function (e) {
      var names = (e.state.offers || []).map(function (o) { return o.name; }).join(' · ');
      return '<li class="' + (e.id === ui.currentId ? 'current' : '') + '"><div class="lib-info"><strong>' + esc(e.title) + '</strong><small>' + esc(names) + '</small><small>עודכן ' + new Date(e.updated).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) + '</small></div>' +
        '<div class="lib-actions"><button type="button" class="btn sm btn-primary" data-lib="open" data-id="' + e.id + '">פתיחה</button>' +
        '<button type="button" class="btn sm" data-lib="copy" data-id="' + e.id + '">שכפול</button>' +
        '<button type="button" class="btn sm danger" data-lib="delete" data-id="' + e.id + '">מחיקה</button></div></li>';
    }).join('') + '</ul>';
  }

  // ---------- share ----------
  function shareUrl() {
    return S.encode(state).then(function (code) {
      return location.href.split('#')[0] + '#c=' + code;
    });
  }
  function openShare() {
    shareUrl().then(function (url) {
      $('#share-url').value = url;
      var text = 'השוואת הצעות משכנתא' + (state.title ? ': ' + state.title : '');
      $('#share-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(text + '\n' + url);
      $('#share-email').href = 'mailto:?subject=' + encodeURIComponent(text) + '&body=' + encodeURIComponent(url);
      $('#btn-native-share').hidden = !navigator.share;
      $('#share-dialog').showModal();
      $('#share-url').select();
    });
  }
  function copyShare() {
    var v = $('#share-url').value;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('הקישור הועתק'); }, function () {
      $('#share-url').select(); document.execCommand('copy'); toast('הקישור הועתק');
    });
  }

  // ---------- theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var btn = $('#btn-theme');
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.setAttribute('aria-label', t === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה');
    btn.title = btn.getAttribute('aria-label');
    if (ui.results.length) renderComparison();
  }

  // ---------- events ----------
  function onPanelInput(e) {
    var t = e.target;
    var o = state.offers[ui.active];
    var card = t.closest('.track');
    if (t.hasAttribute('data-offer')) {
      o[t.getAttribute('data-offer')] = t.value;
      if (t.getAttribute('data-offer') === 'name') {
        var tn = document.querySelector('#tab-' + ui.active + ' .tab-name');
        if (tn) tn.textContent = t.value || ('הצעה ' + (ui.active + 1));
      }
    } else if (t.hasAttribute('data-fee')) {
      o.fees[t.getAttribute('data-fee')] = t.value.replace(/,/g, '');
    } else if (card) {
      var tr = o.tracks[Number(card.getAttribute('data-track'))];
      var key = t.getAttribute('data-key'), adv = t.getAttribute('data-adv');
      var val = t.hasAttribute('data-money') ? t.value.replace(/[^\d.]/g, '') : t.value.trim();
      if (key) {
        if (key === 'type') {
          var oldDef = D.TRACK_BY_ID[tr.type], newDef = D.TRACK_BY_ID[val];
          var r = E.num(tr.rate, NaN), pr = E.num(state.scenario.prime, D.DEFAULT_PRIME);
          if (isFinite(r) && oldDef.rateMode !== newDef.rateMode) {
            tr.rate = +(newDef.rateMode === 'prime' ? r - pr : r + pr).toFixed(2);
          }
          tr.type = val;
          rerenderTrack(card, Number(card.getAttribute('data-track')), '[data-key="type"]');
        } else if (key === 'method') {
          tr.method = val;
          if (val === 'bullet') tr.advanced.prepayMode = 'reduce';
          rerenderTrack(card, Number(card.getAttribute('data-track')), '[data-key="method"]');
        } else {
          tr[key] = val;
          if (key === 'cpi') {
            var hp = document.getElementById(t.id + '-help');
            if (hp) hp.textContent = val === '' ? 'לפי ההנחה הכללית' : '';
          }
        }
      } else if (adv) {
        tr.advanced[adv] = val;
        if (adv === 'prepayType') rerenderTrack(card, Number(card.getAttribute('data-track')), '[data-adv="prepayType"]');
        var cnt = advCount(tr.advanced);
        var ac = card.querySelector('.adv-count');
        if (ac) ac.textContent = cnt ? cnt + ' פעילות' : 'גרייס · שינוי ריבית · סילוק מוקדם';
      }
    }
    markDirty();
    scheduleRecalc();
  }

  function rerenderTrack(card, ti, focusSel) {
    var tmp = document.createElement('div');
    var advOpen = card.querySelector('details.adv').open;
    tmp.innerHTML = renderTrack(state.offers[ui.active].tracks[ti], ti);
    var nc = tmp.firstChild;
    if (advOpen) nc.querySelector('details.adv').open = true;
    card.replaceWith(nc);
    if (focusSel) { var f = nc.querySelector(focusSel); if (f) f.focus(); }
  }

  function onScenarioInput(e) {
    var t = e.target;
    var scope = t.getAttribute('data-scope'), key = t.getAttribute('data-key');
    if (!scope) return;
    var v = t.type === 'checkbox' ? t.checked : (t.hasAttribute('data-money') ? t.value.replace(/[^\d.]/g, '') : t.value.trim());
    state[scope][key] = v;
    if (scope === 'scenario') {
      updateAssumptionsHint();
      if (key === 'cpi') $$('#offer-panel input[data-key="cpi"]').forEach(function (i) { i.placeholder = v; });
    }
    markDirty();
    scheduleRecalc();
  }

  function onPanelClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var o = state.offers[ui.active];
    var card = btn.closest('.track');
    var ti = card ? Number(card.getAttribute('data-track')) : -1;
    if (action === 'add-track') {
      var last = o.tracks[o.tracks.length - 1];
      o.tracks.push(newTrack({ months: last ? last.months : 300 }));
      renderPanel(); recalc();
      var cards = $$('#offer-panel .track');
      var nc = cards[cards.length - 1];
      nc.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nc.querySelector('[data-key="type"]').focus();
    } else if (action === 'dup-track') {
      o.tracks.splice(ti + 1, 0, JSON.parse(JSON.stringify(o.tracks[ti])));
      if (o.tracks.length > D.MAX_TRACKS) o.tracks.length = D.MAX_TRACKS;
      renderPanel(); recalc();
      toast('המסלול שוכפל');
    } else if (action === 'del-track') {
      var removed = o.tracks.splice(ti, 1)[0];
      if (!o.tracks.length) o.tracks.push(newTrack());
      renderPanel(); recalc();
      undoToast('המסלול נמחק', function () { o.tracks.splice(ti, 0, removed); if (o.tracks.length === 2 && !E.num(o.tracks[1].amount, 0) && !o.tracks[1].rate) o.tracks.pop(); renderPanel(); recalc(); });
    } else if (action === 'dup-offer') {
      duplicateOffer(ui.active);
    } else if (action === 'del-offer') {
      deleteOffer(ui.active);
    } else if (action === 'schedule') {
      openSchedule(btn.hasAttribute('data-offer-idx') ? Number(btn.getAttribute('data-offer-idx')) : ui.active);
      return;
    } else if (action === 'goto-offer') {
      selectOffer(Number(btn.getAttribute('data-offer-idx')));
      $('#offers-h').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    markDirty();
  }

  function undoToast(msg, undo) {
    var t = $('#toast');
    t.innerHTML = esc(msg) + ' <button type="button" class="link">ביטול</button>';
    t.classList.add('show');
    t.querySelector('button').onclick = function () { undo(); markDirty(); t.classList.remove('show'); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 6000);
  }

  function duplicateOffer(i) {
    if (state.offers.length >= D.MAX_OFFERS) return;
    var copy = JSON.parse(JSON.stringify(state.offers[i]));
    copy.id = uid();
    copy.name = 'הצעה ' + (state.offers.length + 1);
    state.offers.push(copy);
    selectOffer(state.offers.length - 1);
    markDirty();
    var n = $('#offer-name'); n.focus(); n.select();
    toast('ההצעה שוכפלה – תנו לה שם ועדכנו את הריביות');
  }
  function addOffer() {
    if (state.offers.length >= D.MAX_OFFERS) return;
    var n = state.offers.length + 1;
    state.offers.push(newOffer('הצעה ' + n));
    selectOffer(state.offers.length - 1);
    markDirty();
    var inp = $('#offer-name'); inp.focus(); inp.select();
  }
  function deleteOffer(i) {
    if (state.offers.length <= 1) return;
    var removed = state.offers.splice(i, 1)[0];
    selectOffer(Math.max(0, i - 1));
    markDirty();
    undoToast('ההצעה "' + removed.name + '" נמחקה', function () { state.offers.splice(i, 0, removed); selectOffer(i); });
  }
  function selectOffer(i) {
    ui.active = i;
    renderTabs();
    renderPanel();
    recalc();
  }

  function bind() {
    // assumptions
    $('#assumptions').addEventListener('input', onScenarioInput);
    $('#assumptions').addEventListener('change', onScenarioInput);
    $('#comparison-title').addEventListener('input', function (e) { state.title = e.target.value; markDirty(); });

    // panel
    var panel = $('#offer-panel');
    panel.addEventListener('input', function (e) { if (e.target.tagName === 'INPUT') onPanelInput(e); });
    panel.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT') onPanelInput(e); });
    panel.addEventListener('click', onPanelClick);
    $('#compare').addEventListener('click', function (e) {
      var ch = e.target.closest('[data-chart]');
      if (ch) { ui.chart = ch.getAttribute('data-chart'); renderComparison(); return; }
      onPanelClick(e);
    });

    // money formatting & touched tracking
    document.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t.tagName !== 'INPUT') return;
      if (t.closest('#offer-panel')) { ui.touched[t.id] = true; scheduleRecalc(); }
      if (t.hasAttribute('data-money') && t.value) t.value = groupDigits(t.value.replace(/[^\d.]/g, ''));
    });
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t.tagName === 'INPUT' && t.getAttribute('inputmode') && t.type !== 'checkbox') setTimeout(function () { try { t.select(); } catch (x) {} }, 0);
    });

    // tabs
    var tabs = $('#offer-tabs');
    tabs.addEventListener('click', function (e) {
      if (e.target.closest('#btn-add-offer')) { addOffer(); return; }
      var b = e.target.closest('[data-tab]');
      if (b) selectOffer(Number(b.getAttribute('data-tab')));
    });
    tabs.addEventListener('keydown', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      var i = Number(b.getAttribute('data-tab')), n = state.offers.length, j = null;
      if (e.key === 'ArrowLeft') j = (i + 1) % n;      // RTL: left = next
      else if (e.key === 'ArrowRight') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j !== null) { e.preventDefault(); selectOffer(j); $('#tab-' + j).focus(); }
    });

    // glossary
    document.addEventListener('click', function (e) {
      var info = e.target.closest('.info');
      if (info) { e.preventDefault(); showPopover(info); return; }
      if (!e.target.closest('#popover')) $('#popover').hidden = true;
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('#popover').hidden = true; });
    window.addEventListener('scroll', function () { $('#popover').hidden = true; }, { passive: true });

    // top actions
    $('#btn-save').addEventListener('click', saveComparison);
    $('#btn-library').addEventListener('click', function () { renderLibrary(); $('#library-dialog').showModal(); });
    $('#btn-share').addEventListener('click', openShare);
    $('#btn-copy').addEventListener('click', copyShare);
    $('#btn-native-share').addEventListener('click', function () { navigator.share({ title: 'השוואת משכנתאות', url: $('#share-url').value }).catch(function () {}); });
    $('#btn-theme').addEventListener('click', function () {
      var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(LS_THEME, t); } catch (x) {}
      applyTheme(t);
    });
    $('#btn-new').addEventListener('click', function () {
      if (ui.dirty && !confirm('לפתוח השוואה חדשה? שינויים שלא נשמרו יאבדו (הטיוטה הנוכחית תוחלף).')) return;
      var s = defaultState();
      s.offers = [newOffer('הצעה 1')];
      s.offers[0].tracks = [newTrack({ type: 'prime' }), newTrack({ type: 'fixed_unlinked' }), newTrack({ type: 'var5_linked' })];
      hideBanner();
      loadState(s, {});
      toast('נפתחה השוואה חדשה');
    });

    // dialogs
    $$('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    });
    $('#schedule-track').addEventListener('change', function (e) { sched.track = e.target.value; renderSchedule(); });
    $$('#schedule-dialog [data-view]').forEach(function (b) { b.addEventListener('click', function () { sched.view = b.getAttribute('data-view'); renderSchedule(); }); });
    $('#btn-csv').addEventListener('click', exportCsv);
    $('#btn-print').addEventListener('click', function () { document.body.classList.add('printing-schedule'); window.print(); });
    window.addEventListener('afterprint', function () { document.body.classList.remove('printing-schedule'); });
    $('#library-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-lib]');
      if (!b) return;
      var id = b.getAttribute('data-id'), act = b.getAttribute('data-lib');
      var list = loadSaved();
      var entry = list.find(function (x) { return x.id === id; });
      if (act === 'open') {
        if (ui.dirty && ui.currentId !== id && !confirm('לפתוח את ההשוואה? שינויים שלא נשמרו בהשוואה הנוכחית יאבדו.')) return;
        hideBanner();
        openSaved(id); $('#library-dialog').close();
      } else if (act === 'copy') {
        var c = JSON.parse(JSON.stringify(entry)); c.id = uid(); c.title = entry.title + ' (עותק)'; c.updated = Date.now(); c.state.title = c.title;
        list.unshift(c); writeSaved(list); renderLibrary();
      } else if (act === 'delete') {
        if (!confirm('למחוק את "' + entry.title + '"?')) return;
        writeSaved(list.filter(function (x) { return x.id !== id; }));
        if (ui.currentId === id) { ui.currentId = null; markDirty(); }
        renderLibrary();
      }
    });
    $('#banner').addEventListener('click', function (e) {
      if (e.target.closest('[data-banner="save"]')) saveComparison();
      if (e.target.closest('[data-banner="close"]')) hideBanner();
    });

    window.addEventListener('beforeunload', function (e) {
      if (ui.dirty && ui.currentId) { e.preventDefault(); e.returnValue = ''; }
    });
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { var items = state.offers.map(function (o, i) { return { offer: o, idx: i, res: ui.results[i] }; }).filter(function (x) { return x.res.summary; }); if (items.length) drawChart(items); }, 150); });
    window.addEventListener('hashchange', loadFromHash);
  }

  function loadFromHash() {
    var m = location.hash.match(/^#c=(.+)$/);
    if (!m) return Promise.resolve(false);
    return S.decode(m[1]).then(function (s) {
      history.replaceState(null, '', location.pathname + location.search);
      loadState(normalizeState(s), { dirty: true });
      ui.shared = true;
      showBanner('<span>נפתחה השוואה ששותפה איתכם' + (s.title ? ': <strong>' + esc(s.title) + '</strong>' : '') + '. אפשר לערוך בחופשיות – השינויים לא ישפיעו על הקישור המקורי.</span>' +
        '<span class="banner-actions"><button type="button" class="btn btn-primary sm" data-banner="save">שמירת עותק אצלי</button><button type="button" class="btn sm btn-ghost" data-banner="close" aria-label="סגירה">✕</button></span>');
      return true;
    }).catch(function () {
      history.replaceState(null, '', location.pathname + location.search);
      toast('הקישור אינו תקין או פגום');
      return false;
    });
  }

  // ---------- init ----------
  function init() {
    renderDatalists();
    bind();
    applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
    var draft = null;
    try { draft = JSON.parse(localStorage.getItem(LS_DRAFT)); } catch (e) {}
    if (draft && draft.state) loadState(normalizeState(draft.state), { currentId: draft.currentId, dirty: draft.dirty, active: draft.active });
    else loadState(defaultState(), {});
    loadFromHash();
  }

  // expose for debugging/tests
  window.MortgageApp = { getState: function () { return state; }, getResults: function () { return ui.results; } };
  init();
})();
