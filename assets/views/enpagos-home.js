// EnPagos Home — F3.1 skeleton: PeriodSelector + fetch loop with AbortController.
// Backend: optix-proxy /client_data_public?view=home (PROD, deploy v20260526-s2-view-home).
// SPEC: Slack canvas F0B65HXAUN7.
//
// This file owns only the period/state/fetch lifecycle. Section content rendering
// (goals, hero, KPI strip, dropdowns, plaza cards, today detail) lands in F3.2-F3.6.
// When data arrives we stash it on `window.__homeData` and log top-level keys — that's
// the integration surface F3.2+ reads from.
(function () {
  'use strict';

  var HOME_VALID_PERIODS = ['today', 'yesterday', '7d', '30d', 'mtd', 'last_month'];
  var DEFAULT_PERIOD = 'mtd';
  var ENDPOINT = 'https://optix-proxy.anwarhsg.workers.dev/client_data_public';
  var CLIENT = 'enpagos';
  var SKELETON_DEBOUNCE_MS = 300;

  // Human-readable chip labels, in the same order as HOME_VALID_PERIODS.
  var PERIOD_LABELS = {
    today: 'Hoy',
    yesterday: 'Ayer',
    '7d': '7d',
    '30d': '30d',
    mtd: 'MTD',
    last_month: 'Mes Pasado'
  };

  var SECTION_IDS = [
    'goals-section',
    'hero-section',
    'kpi-strip-section',
    'dropdowns-section',
    'plaza-cards-section',
    'today-detail-section'
  ];

  var currentPeriod = null;
  var currentController = null;

  function getInitialPeriod() {
    var hash = window.location.hash || '';
    var m = hash.match(/#period=([^&]+)/);
    if (m && HOME_VALID_PERIODS.indexOf(m[1]) !== -1) {
      return m[1];
    }
    try {
      var saved = window.localStorage.getItem('enpagos_home_period');
      if (saved && HOME_VALID_PERIODS.indexOf(saved) !== -1) {
        return saved;
      }
    } catch (e) {
      // localStorage blocked (private mode / quota) — fall through to default.
    }
    return DEFAULT_PERIOD;
  }

  function renderPeriodSelector(active) {
    var nav = document.getElementById('period-selector');
    if (!nav) return;
    var html = '';
    for (var i = 0; i < HOME_VALID_PERIODS.length; i++) {
      var p = HOME_VALID_PERIODS[i];
      var cls = 'period-chip' + (p === active ? ' active' : '');
      html += '<button type="button" class="' + cls + '" data-period="' + p + '">' +
              PERIOD_LABELS[p] + '</button>';
    }
    nav.innerHTML = html;
    nav.classList.add('loading');
    var chips = nav.querySelectorAll('.period-chip');
    for (var j = 0; j < chips.length; j++) {
      chips[j].addEventListener('click', onChipClick);
    }
  }

  function setSelectorLoading(loading) {
    var nav = document.getElementById('period-selector');
    if (!nav) return;
    if (loading) nav.classList.add('loading');
    else nav.classList.remove('loading');
  }

  function onChipClick(evt) {
    var period = evt.currentTarget.getAttribute('data-period');
    switchPeriod(period);
  }

  function switchPeriod(newPeriod) {
    if (newPeriod === currentPeriod) return;
    if (currentController) {
      try { currentController.abort(); } catch (e) { /* noop */ }
    }
    try {
      window.location.hash = '#period=' + newPeriod;
    } catch (e) { /* noop */ }
    try {
      window.localStorage.setItem('enpagos_home_period', newPeriod);
    } catch (e) { /* noop */ }
    fetchAndRender(newPeriod);
  }

  function fetchAndRender(period) {
    currentPeriod = period;
    currentController = new AbortController();
    renderPeriodSelector(period);

    var skeletonTimer = setTimeout(showSkeletons, SKELETON_DEBOUNCE_MS);
    var url = ENDPOINT + '?client=' + encodeURIComponent(CLIENT) +
              '&view=home&period=' + encodeURIComponent(period);
    var signal = currentController.signal;

    fetch(url, { signal: signal })
      .then(function (resp) {
        if (!resp.ok) {
          var err = new Error('HTTP ' + resp.status);
          err.status = resp.status;
          throw err;
        }
        return resp.json();
      })
      .then(function (data) {
        clearTimeout(skeletonTimer);
        hideSkeletons();
        // Race fix: ignore stale responses if the user already switched again.
        if (currentPeriod !== period) return;
        window.__homeData = data;
        var topKeys = data && typeof data === 'object' ? Object.keys(data).join(',') : '<non-object>';
        console.log('[enpagos-home] data loaded for period=' + period + ', top-level keys: ' + topKeys);
        renderGoals(data);
        renderHero(data, period);
        renderKpiStrip(data, period);
        clearBanner();
        setSelectorLoading(false);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          // Expected when user switches periods rapidly; do not surface.
          return;
        }
        clearTimeout(skeletonTimer);
        hideSkeletons();
        setSelectorLoading(false);
        showErrorBanner(period, err);
      });
  }

  // ── F3.2 Goals card ────────────────────────────────────────────────────
  //
  // Three chips: Cierres, Inversión, CAC. Each chip reads from a different
  // tier of the response — actuals from totals.current, denominator from
  // goals_prorrated (NOT goals — prorrated reflects the MTD-elapsed slice
  // so the % matches what the user sees on the date the chip is rendered),
  // % directly from totals.vs_goal (NOT computed client-side — the backend
  // applies its own rounding/edge-case logic and we keep the calculation
  // single-sourced).
  //
  // Graceful degradation (S77-locked):
  //   - inversion_total_meta_ads in (0, null) → "—" valor + "—" pct, tooltip
  //     "Pipeline de inversión actualizando". Triggers any day the FB spend
  //     sync is delayed; without this the user sees a misleading "$0".
  //   - cac in (0, null) AND cierres > 0 → same "—/—" treatment.
  //   - cac_status in (verde|amarillo|rojo) → border-left color tint on the
  //     CAC chip; missing/unknown → neutral.

  function _fmtInt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(Number(n)).toLocaleString('es-MX');
  }

  function _fmtCurrency(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(Number(n)).toLocaleString('es-MX');
  }

  function _fmtPct(decimal) {
    if (decimal == null || isNaN(decimal)) return '—';
    // Backend stores ratios as decimals (0.557 = 55.7%). Multiply x100 + round.
    return Math.round(Number(decimal) * 100) + '%';
  }

  function _fmtFloat2(n) {
    // 2 decimal places for fractional metrics like daily_avg_business_days (0.65).
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(2);
  }

  function _statusClass(status) {
    // Backend contract: cac_status / costo_preaut_positivo_status come as
    // English strings 'green' | 'yellow' | 'red'. CSS class names mirror
    // the backend so there's no translation layer — if the contract ever
    // changes the test breaks loud rather than silently dropping the tint.
    if (status === 'green')  return 'goal-chip--status-green';
    if (status === 'yellow') return 'goal-chip--status-yellow';
    if (status === 'red')    return 'goal-chip--status-red';
    return '';
  }

  function _chipHTML(opts) {
    // opts: { label, valueHTML, goalHTML, pctHTML, statusCls, tooltip, gracefulCls }
    var tooltipAttr = opts.tooltip ? ' title="' + escapeHtml(opts.tooltip) + '"' : '';
    var cls = 'goal-chip';
    if (opts.statusCls) cls += ' ' + opts.statusCls;
    if (opts.gracefulCls) cls += ' ' + opts.gracefulCls;
    var pctBlock = opts.pctHTML
      ? '<span class="goal-chip__pct">(' + opts.pctHTML + ')</span>'
      : '';
    return (
      '<div class="' + cls + '"' + tooltipAttr + '>' +
        '<span class="goal-chip__label">' + escapeHtml(opts.label) + '</span>' +
        '<span class="goal-chip__values">' +
          '<span class="goal-chip__value">' + opts.valueHTML + '</span>' +
          '<span class="goal-chip__sep">/</span>' +
          '<span class="goal-chip__goal">' + opts.goalHTML + '</span>' +
        '</span>' +
        pctBlock +
      '</div>'
    );
  }

  function renderGoals(data) {
    var sec = document.getElementById('goals-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    var current   = (data.totals && data.totals.current)   || {};
    var prorrated = data.goals_prorrated                  || {};
    var vsGoal    = (data.totals && data.totals.vs_goal)   || {};

    // ── Cierres chip ──
    var cierresVal  = current.cierres;
    var cierresGoal = prorrated.cierres_goal_periodo;
    var cierresPct  = vsGoal.cierres_pct;
    var cierresHTML = _chipHTML({
      label: 'Cierres',
      valueHTML: _fmtInt(cierresVal),
      goalHTML:  _fmtInt(cierresGoal),
      pctHTML:   _fmtPct(cierresPct)
    });

    // ── Inversión chip — graceful when spend pipeline down ──
    var invVal  = current.inversion_total_meta_ads;
    var invGoal = prorrated.inversion_planeada_periodo;
    var invPct  = vsGoal.inversion_pct;
    var invDown = (invVal == null || invVal === 0);
    var invHTML = _chipHTML({
      label: 'Inversión',
      valueHTML: invDown ? '—' : _fmtCurrency(invVal),
      goalHTML:  _fmtCurrency(invGoal),
      pctHTML:   invDown ? '—' : _fmtPct(invPct),
      gracefulCls: invDown ? 'goal-chip--graceful' : '',
      tooltip:   invDown ? 'Pipeline de inversión actualizando' : ''
    });

    // ── CAC chip — no %, status color instead ──
    var cacVal    = current.cac;
    var cacGoal   = data.goals && data.goals.cac_meta && data.goals.cac_meta.valor;
    var cacStatus = vsGoal.cac_status;
    var cacDown   = (cacVal == null || cacVal === 0) && (cierresVal != null && cierresVal > 0);
    var cacHTML = _chipHTML({
      label: 'CAC',
      valueHTML: cacDown ? '—' : _fmtCurrency(cacVal),
      goalHTML:  _fmtCurrency(cacGoal),
      pctHTML:   '',  // CAC uses color status, not %
      statusCls: _statusClass(cacStatus),
      gracefulCls: cacDown ? 'goal-chip--graceful' : '',
      tooltip:   cacDown ? 'Pipeline de inversión actualizando' : ''
    });

    sec.innerHTML =
      '<div class="goals-chips" role="group" aria-label="Metas del periodo">' +
        cierresHTML + invHTML + cacHTML +
      '</div>';
  }

  // Exposed so F3.x tests / inspection can call without a network fetch:
  //   window.__homeData = {...}; window.__renderGoals(window.__homeData);
  window.__renderGoals = renderGoals;

  // ── F3.3 Hero section + ProjectionCard ─────────────────────────────────
  //
  // Two big cards (Cierres MTD | Inversión MTD) side-by-side on desktop,
  // stacked on mobile. ProjectionCard appears below them only when
  // period === 'mtd' (EOM projection is meaningless against other windows).
  //
  // Why an inline progress bar instead of assets/components/ProgressBar.js:
  // that component's CSS is scoped to .app-redesign and depends on the
  // design-token stylesheet (--color-success, --space-2, etc.) which this
  // standalone F3 view does not load. Reusing it would require dragging two
  // additional stylesheets + adding a wrapper class — disproportionate for
  // 2 bars. F3.3 ships its own minimal bar; design-system migration is a
  // separate sprint.
  //
  // Status thresholds per S77 SPEC (NOT ProgressBar's deriveTier rule):
  //   cierres: pct < 0.50 → red, 0.50 ≤ pct < 0.80 → yellow, pct ≥ 0.80 → green
  //   inversion: no status until backend ships inversion_status (omit color)
  //
  // The Cierres status is computed CLIENT-SIDE because vs_goal doesn't ship
  // cierres_status today — only cac_status + costo_preaut_positivo_status.
  // When backend adds cierres_status, swap to backend value + delete this
  // helper to keep single-source-of-truth.

  function _cierresStatusFromPct(pct) {
    if (pct == null || isNaN(pct)) return '';
    var p = Number(pct);
    if (p < 0.50) return 'red';
    if (p < 0.80) return 'yellow';
    return 'green';
  }

  function _progressBarHTML(opts) {
    // opts: { pct (0..1), status ('green'|'yellow'|'red'|''), graceful (bool) }
    var pct = opts.pct == null || isNaN(opts.pct) ? 0 : Number(opts.pct);
    var fillPct = Math.max(0, Math.min(100, pct * 100));
    var cls = 'hero-bar';
    if (opts.graceful) cls += ' hero-bar--graceful';
    var fillCls = 'hero-bar__fill';
    if (opts.status) fillCls += ' hero-bar__fill--' + opts.status;
    return (
      '<div class="' + cls + '" role="progressbar"' +
        ' aria-valuenow="' + fillPct.toFixed(1) + '"' +
        ' aria-valuemin="0" aria-valuemax="100">' +
        '<div class="' + fillCls + '" style="width:' + fillPct.toFixed(1) + '%"></div>' +
      '</div>'
    );
  }

  function _heroCardHTML(opts) {
    // opts: { label, bigHTML, subRightHTML, barHTML, footHTML, gracefulCls, tooltip }
    var cls = 'hero-card';
    if (opts.gracefulCls) cls += ' ' + opts.gracefulCls;
    var tooltipAttr = opts.tooltip ? ' title="' + escapeHtml(opts.tooltip) + '"' : '';
    return (
      '<div class="' + cls + '"' + tooltipAttr + '>' +
        '<div class="hero-card__label">' + escapeHtml(opts.label) + '</div>' +
        '<div class="hero-card__row">' +
          '<span class="hero-card__big">' + opts.bigHTML + '</span>' +
          (opts.subRightHTML ? '<span class="hero-card__sub-right">' + opts.subRightHTML + '</span>' : '') +
        '</div>' +
        (opts.barHTML || '') +
        (opts.footHTML ? '<div class="hero-card__foot">' + opts.footHTML + '</div>' : '') +
      '</div>'
    );
  }

  function _projectionStatusFromGap(projected, goal) {
    if (projected == null || goal == null || goal <= 0) return '';
    if (projected >= goal) return 'green';
    if (projected >= goal * 0.80) return 'yellow';
    return 'red';
  }

  function renderProjection(data) {
    // Only called when period === 'mtd' AND data.totals.projection exists.
    var projection = data.totals && data.totals.projection;
    if (!projection) return '';
    var goal = data.goals && data.goals.cierres_meta && data.goals.cierres_meta.valor;
    var projectedC = projection.projected_cierres_eom;
    var gap = (projectedC != null && goal != null) ? Math.round(goal - projectedC) : null;
    var status = _projectionStatusFromGap(projectedC, goal);

    var gapLine;
    if (gap == null) {
      gapLine = '';
    } else if (gap <= 0) {
      gapLine = '<span class="proj-card__status proj-card__status--green">Vas a cumplir</span>';
    } else {
      gapLine = '<span class="proj-card__status proj-card__status--' + status + '">' +
                'Faltan ' + gap + ' cierre' + (gap === 1 ? '' : 's') + ' para meta</span>';
    }

    var daily = projection.daily_avg_business_days;
    var bdt = projection.business_days_total;
    var bdp = projection.business_days_passed;
    var basisLine = (daily != null && bdt != null && bdp != null)
      ? 'Basado en ' + Number(daily).toFixed(2) + ' cierres/día × ' + bdt +
        ' días hábiles (' + bdp + ' pasados)'
      : '';

    // Inversión proyectada — omit block when 0 (per spec: no "—" placeholder).
    var invProjected = projection.projected_inversion_eom;
    var invGoal = data.goals && data.goals.inversion_meta && data.goals.inversion_meta.valor;
    var invBlock = '';
    if (invProjected != null && invProjected > 0) {
      invBlock = '<div class="proj-card__inv">' +
                   _fmtCurrency(invProjected) + ' proyectado vs ' + _fmtCurrency(invGoal) + ' plan' +
                 '</div>';
    }

    return (
      '<div class="proj-card">' +
        '<div class="proj-card__title">Proyección al cierre del mes</div>' +
        '<div class="proj-card__big">' + _fmtInt(projectedC) + ' cierres proyectados</div>' +
        (gapLine ? '<div class="proj-card__gap">' + gapLine + '</div>' : '') +
        (basisLine ? '<div class="proj-card__basis">' + escapeHtml(basisLine) + '</div>' : '') +
        invBlock +
      '</div>'
    );
  }

  function renderHero(data, period) {
    var sec = document.getElementById('hero-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    var current   = (data.totals && data.totals.current)   || {};
    var prorrated = data.goals_prorrated                   || {};
    var vsGoal    = (data.totals && data.totals.vs_goal)   || {};
    var goals     = data.goals                             || {};

    var isMtd = (period === 'mtd');

    // ── Cierres card ──
    var cierresVal  = current.cierres;
    var cierresPct  = vsGoal.cierres_pct;
    var cierresStatus = _cierresStatusFromPct(cierresPct);
    var cierresCard;
    if (isMtd) {
      var cierresGoalProrr = prorrated.cierres_goal_periodo;
      var cierresFullGoal = goals.cierres_meta && goals.cierres_meta.valor;
      cierresCard = _heroCardHTML({
        label: 'Cierres MTD',
        bigHTML: _fmtInt(cierresVal),
        subRightHTML: '/ ' + _fmtInt(cierresGoalProrr) + ' meta del periodo',
        barHTML: _progressBarHTML({ pct: cierresPct, status: cierresStatus }),
        footHTML: cierresFullGoal != null
          ? _fmtInt(cierresFullGoal) + ' al cierre del mes'
          : ''
      });
    } else {
      cierresCard = _heroCardHTML({
        label: 'Cierres',
        bigHTML: _fmtInt(cierresVal),
        footHTML: 'Periodo: ' + escapeHtml(period || '—')
      });
    }

    // ── Inversión card ──
    var invVal  = current.inversion_total_meta_ads;
    var invPct  = vsGoal.inversion_pct;
    var invDown = (invVal == null || invVal === 0);
    var invCard;
    if (isMtd) {
      var invGoalProrr = prorrated.inversion_planeada_periodo;
      var invFullGoal = goals.inversion_meta && goals.inversion_meta.valor;
      invCard = _heroCardHTML({
        label: 'Inversión MTD',
        bigHTML: invDown ? '—' : _fmtCurrency(invVal),
        subRightHTML: '/ ' + _fmtCurrency(invGoalProrr) + ' plan del periodo',
        // No status color — backend hasn't shipped inversion_status; neutral bar.
        // Graceful when down: bar shows 0% in grey (graceful class drops it
        // visually) so users see "pipeline pending" not "completely missed plan".
        barHTML: _progressBarHTML({ pct: invDown ? 0 : invPct, status: '', graceful: invDown }),
        footHTML: invFullGoal != null
          ? _fmtCurrency(invFullGoal) + ' al cierre del mes'
          : '',
        gracefulCls: invDown ? 'hero-card--graceful' : '',
        tooltip: invDown ? 'Pipeline de inversión actualizando' : ''
      });
    } else {
      invCard = _heroCardHTML({
        label: 'Inversión',
        bigHTML: invDown ? '—' : _fmtCurrency(invVal),
        footHTML: 'Periodo: ' + escapeHtml(period || '—'),
        gracefulCls: invDown ? 'hero-card--graceful' : '',
        tooltip: invDown ? 'Pipeline de inversión actualizando' : ''
      });
    }

    // ── ProjectionCard — only for mtd ──
    var projectionHTML = isMtd ? renderProjection(data) : '';

    sec.innerHTML =
      '<div class="hero-cards">' + cierresCard + invCard + '</div>' +
      projectionHTML;
  }

  window.__renderHero = renderHero;

  // ── F3.4 KPI strip — 5 KPIs in a row ──────────────────────────────────
  //
  // 5 cards: MENSAJES | PREAUT BRUTOS | PREAUT+ | FIRMAS PROG. | CANCELADOS
  //
  // Backend audit (period=mtd, verified 2026-05-28):
  //   totals.delta has mensajes_abs (0) and preaut_positivos_abs (58).
  //   It does NOT have preaut_brutos_*, firmas_programadas_*, cancelados_*.
  //   For those 3 KPIs we render "—" in the comparison line (period label
  //   still rendered for context, so the row stays visually balanced).
  //
  // The "vs {previous_period}" comparison line is new in F3.4 — Hero (F3.3)
  // doesn't render any vs-previous line, so there was no pattern to mirror.
  // Color scheme below: green for positive delta, red for negative, grey
  // for zero or missing. Period label is derived from meta.previous_period
  // (not hardcoded) so it stays correct across periods.
  //
  // Defensive: if backend ever ships *_pct for these KPIs, _deltaLineHTML
  // falls back to that with a >999% guardrail (matches the rounding
  // discipline elsewhere in this file).

  // Aligned to enpagos-daily.js:293-311 ("vs ABRIL (1-28)" pattern) per
  // cross-view consistency requirement. Returns the suffix only — caller
  // prepends "vs ". Hardcoded "(1-N)" + uppercase full month name mirrors
  // Daily's behavior exactly, including its assumption that prev period
  // starts on day 1 of its month (true for mtd; approximate for 7d/30d
  // windows that cross month boundaries — same approximation Daily ships).
  //
  // DEUDA (filed by Anwar, not in scope today): Opción 2 — extract this
  // helper to a shared module (e.g. assets/views/_period-label.js) imported
  // by both Home and Daily so future drift is impossible. Pending Home
  // stabilization (post-F3.8).
  var _MONTH_NAMES_UPPER = [
    'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
    'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
  ];

  function _formatPreviousRange(previousPeriod) {
    // previousPeriod: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', days: N }.
    // Returns "ABRIL (1-28)" suffix. Fallback "periodo anterior" preserved
    // for the missing-shape branch (per Anwar: don't change the fallback
    // when meta.previous_period is absent).
    if (!previousPeriod || !previousPeriod.from || !previousPeriod.to) {
      return 'periodo anterior';
    }
    var fromParts = String(previousPeriod.from).split('-');
    var toParts   = String(previousPeriod.to).split('-');
    if (fromParts.length !== 3 || toParts.length !== 3) return 'periodo anterior';
    var monthNum = parseInt(fromParts[1], 10);
    var toDay    = parseInt(toParts[2], 10);
    var monthName = _MONTH_NAMES_UPPER[monthNum - 1];
    if (!monthName || isNaN(toDay)) return 'periodo anterior';
    return monthName + ' (1-' + toDay + ')';
  }

  function _deltaLineHTML(absDelta, pctDelta, periodLabel) {
    // Priority: _abs first (more useful for these counting metrics).
    // Falls through to _pct if no _abs but pct is present and sane.
    // Returns gray "—" placeholder when neither is meaningful.
    var label = ' vs ' + escapeHtml(periodLabel);
    if (absDelta != null && !isNaN(absDelta)) {
      var n = Number(absDelta);
      if (n > 0) {
        return '<div class="kpi-delta kpi-delta--up">▲ +' + _fmtInt(n) + label + '</div>';
      }
      if (n < 0) {
        return '<div class="kpi-delta kpi-delta--down">▼ ' + _fmtInt(n) + label + '</div>';
      }
      // delta = 0: neutral, still informative ("we didn't move")
      return '<div class="kpi-delta kpi-delta--zero">— 0' + label + '</div>';
    }
    if (pctDelta != null && !isNaN(pctDelta)) {
      var p = Number(pctDelta);
      // >999% guardrail — happens when previous=0 and backend computes
      // division-by-zero as infinity. Suppress to "—".
      if (Math.abs(p) > 999) {
        return '<div class="kpi-delta kpi-delta--missing">—' + label + '</div>';
      }
      var pctStr = (p >= 0 ? '+' : '') + _fmtPct(p);
      var cls = p > 0 ? 'kpi-delta--up' : (p < 0 ? 'kpi-delta--down' : 'kpi-delta--zero');
      var arrow = p > 0 ? '▲ ' : (p < 0 ? '▼ ' : '— ');
      return '<div class="kpi-delta ' + cls + '">' + arrow + pctStr + label + '</div>';
    }
    // Neither _abs nor _pct → missing. Show "—" same color as zero, no number.
    return '<div class="kpi-delta kpi-delta--missing">—' + label + '</div>';
  }

  function _kpiCardHTML(opts) {
    // opts: { label, valueHTML, deltaHTML }
    return (
      '<div class="kpi-card">' +
        '<div class="kpi-card__label">' + escapeHtml(opts.label) + '</div>' +
        '<div class="kpi-card__big">' + opts.valueHTML + '</div>' +
        (opts.deltaHTML || '') +
      '</div>'
    );
  }

  function renderKpiStrip(data, period) {
    var sec = document.getElementById('kpi-strip-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    // Diseño A — KPI strip muestra métricas de PROYECCIÓN, sólo significativas
    // bajo period='mtd' (proyección EOM contra otros windows = nonsense).
    // En periods != mtd la sección se limpia sin empty state (UX silencioso).
    if (period !== 'mtd') {
      sec.innerHTML = '';
      return;
    }
    var current    = (data.totals && data.totals.current)    || {};
    var projection = (data.totals && data.totals.projection) || {};
    var delta      = (data.totals && data.totals.delta)      || {};
    var meta       = data.meta                               || {};
    var periodLabel = _formatPreviousRange(meta.previous_period);

    // 4 métricas del Diseño A (SPEC canvas F0B65HXAUN7):
    //  1. Today's Cierres        → totals.current.cierres       (MTD count hoy)
    //  2. Daily Avg (días háb.)  → totals.projection.daily_avg_business_days
    //  3. Projected EOM Cierres  → totals.projection.projected_cierres_eom
    //  4. Projected EOM Inversión→ totals.projection.projected_inversion_eom
    //
    // "Today's Cierres" no existe en totals.projection; interpretación más
    // literal es el contador MTD de hoy (current.cierres). Flagged en
    // F3.INV report — corregible en mismo PR si SPEC quiso decir otra cosa.
    //
    // Solo Cierres MTD tiene delta backend (cierres_abs); las otras 3 son
    // métricas derivadas/proyectivas sin counterpart en periodo previo —
    // delta line muestra "— vs ABRIL (1-28)" (gris missing).
    var KPIS = [
      { label: "Cierres hoy",         value: current.cierres,                         absKey: 'cierres_abs', formatter: _fmtInt },
      { label: "Cierres/día háb.",    value: projection.daily_avg_business_days,      formatter: _fmtFloat2 },
      { label: "Proy. cierres EOM",   value: projection.projected_cierres_eom,        formatter: _fmtInt },
      { label: "Proy. inversión EOM", value: projection.projected_inversion_eom,      formatter: _fmtCurrency }
    ];

    var cardsHTML = '';
    for (var i = 0; i < KPIS.length; i++) {
      var k = KPIS[i];
      var abs = k.absKey ? delta[k.absKey] : null;
      var pct = k.pctKey ? delta[k.pctKey] : null;
      cardsHTML += _kpiCardHTML({
        label: k.label,
        valueHTML: k.formatter(k.value),
        deltaHTML: _deltaLineHTML(abs, pct, periodLabel)
      });
    }

    sec.innerHTML = '<div class="kpi-strip">' + cardsHTML + '</div>';
  }

  window.__renderKpiStrip = renderKpiStrip;

  function showSkeletons() {
    for (var i = 0; i < SECTION_IDS.length; i++) {
      var sec = document.getElementById(SECTION_IDS[i]);
      if (!sec) continue;
      sec.innerHTML = '<div class="skeleton-card"></div>';
    }
  }

  function hideSkeletons() {
    for (var i = 0; i < SECTION_IDS.length; i++) {
      var sec = document.getElementById(SECTION_IDS[i]);
      if (!sec) continue;
      var skels = sec.querySelectorAll('.skeleton-card');
      for (var j = 0; j < skels.length; j++) {
        skels[j].parentNode.removeChild(skels[j]);
      }
    }
  }

  function showErrorBanner(period, err) {
    var container = document.getElementById('banner-container');
    if (!container) return;
    var status = err && err.status ? ' (' + err.status + ')' : '';
    container.innerHTML =
      '<div class="banner banner--error" role="alert">' +
        '<span class="banner__text">No se pudo cargar el periodo ' +
          escapeHtml(period) + status + '.</span>' +
        '<button type="button" class="banner__retry" data-period="' +
          escapeHtml(period) + '">Reintentar</button>' +
      '</div>';
    var btn = container.querySelector('.banner__retry');
    if (btn) {
      btn.addEventListener('click', function () {
        clearBanner();
        // Force-refetch even if period unchanged: reset currentPeriod first.
        currentPeriod = null;
        switchPeriod(period);
      });
    }
  }

  function clearBanner() {
    var container = document.getElementById('banner-container');
    if (container) container.innerHTML = '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function init() {
    var p = getInitialPeriod();
    switchPeriod(p);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
