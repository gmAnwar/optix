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

  function _statusClass(status) {
    if (status === 'verde') return 'goal-chip--status-verde';
    if (status === 'amarillo') return 'goal-chip--status-amarillo';
    if (status === 'rojo') return 'goal-chip--status-rojo';
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
