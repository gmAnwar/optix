// ============================================
// INMOBILI HOME — Dashboard Optix
// Standalone vanilla JS, sin SPA modular
// ============================================

(function () {
  'use strict';

  // ──────────────────────────────────────────
  // CONFIG
  // ──────────────────────────────────────────
  const ENDPOINT_BASE = 'https://optix-proxy.anwarhsg.workers.dev/client_data_public';
  const CLIENT = 'inmobili';
  const VIEW = 'home';
  const FIXTURE_PATH = '/assets/fixtures/inmobili-home-mtd.json';

  const VALID_PERIODS = ['today', 'yesterday', '7d', '30d', 'mtd', 'last_month'];
  const PERIOD_LABELS = {
    today:      'Hoy',
    yesterday:  'Ayer',
    '7d':       '7 días',
    '30d':      '30 días',
    mtd:        'MTD',
    last_month: 'Mes Pasado'
  };
  const DEFAULT_PERIOD = 'mtd';

  const PLAZA_LABELS = {
    all:     'Todas las Plazas',
    torreon: 'Torreón',
    gomez:   'Gómez Palacios'
  };

  const LS_PERIOD_KEY  = 'inmobili_home_period';
  const LS_MODE_KEY    = 'inmobili_home_mode';   // 'captaciones' | 'venta'
  const LS_PLAZA_KEY   = 'inmobili_home_plaza';  // 'all' | 'torreon' | 'gomez'

  // ──────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────
  let state = {
    period: DEFAULT_PERIOD,
    mode:   'captaciones',
    plaza:  'all',
    data:   null,
    loading: false,
    error:  null
  };

  let currentController = null;
  let currentRequestId = 0;

  // ──────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    // 1. Restore state (hash > localStorage > default)
    state.period = readPeriodFromHash() || readLS(LS_PERIOD_KEY, DEFAULT_PERIOD);
    state.mode   = readLS(LS_MODE_KEY, 'captaciones');
    state.plaza  = readLS(LS_PLAZA_KEY, 'all');

    if (!VALID_PERIODS.includes(state.period)) state.period = DEFAULT_PERIOD;
    if (!['captaciones', 'venta'].includes(state.mode)) state.mode = 'captaciones';
    if (!['all', 'torreon', 'gomez'].includes(state.plaza)) state.plaza = 'all';

    // 2. Bind controls
    bindPeriodChips();
    bindModeToggle();
    bindPlazaSelect();
    bindHashListener();

    // 3. Apply initial UI state
    syncControlsToState();

    // 4. Fetch data
    fetchAndRender();
  }

  // ──────────────────────────────────────────
  // CONTROLS BINDING
  // ──────────────────────────────────────────
  function bindPeriodChips() {
    document.querySelectorAll('.period-chip').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.dataset.period;
        if (state.period === p) return;
        state.period = p;
        writeLS(LS_PERIOD_KEY, p);
        writeHashPeriod(p);
        syncPeriodChips();
        fetchAndRender();
      });
    });
  }

  function bindModeToggle() {
    document.querySelectorAll('.mode-toggle button').forEach(el => {
      el.addEventListener('click', () => {
        const m = el.dataset.mode;
        if (state.mode === m) return;
        state.mode = m;
        writeLS(LS_MODE_KEY, m);
        syncModeToggle();
        // Mode change: no re-fetch, render local
        renderHeroLeft();
        renderGoalsBanner();
      });
    });
  }

  function bindPlazaSelect() {
    const sel = document.getElementById('plaza-select');
    if (!sel) return;
    sel.addEventListener('change', e => {
      const p = e.target.value;
      if (state.plaza === p) return;
      state.plaza = p;
      writeLS(LS_PLAZA_KEY, p);
      // Plaza change: no re-fetch, render local re-scope
      renderAll();
    });
  }

  function bindHashListener() {
    window.addEventListener('hashchange', () => {
      const p = readPeriodFromHash();
      if (p && p !== state.period && VALID_PERIODS.includes(p)) {
        state.period = p;
        writeLS(LS_PERIOD_KEY, p);
        syncPeriodChips();
        fetchAndRender();
      }
    });
  }

  function syncControlsToState() {
    syncPeriodChips();
    syncModeToggle();
    const sel = document.getElementById('plaza-select');
    if (sel) sel.value = state.plaza;
  }

  function syncPeriodChips() {
    document.querySelectorAll('.period-chip').forEach(el => {
      el.classList.toggle('active', el.dataset.period === state.period);
    });
  }

  function syncModeToggle() {
    document.querySelectorAll('.mode-toggle button').forEach(el => {
      el.classList.toggle('active', el.dataset.mode === state.mode);
    });
  }

  // ──────────────────────────────────────────
  // HASH + LOCALSTORAGE
  // ──────────────────────────────────────────
  function readPeriodFromHash() {
    const h = window.location.hash.replace(/^#/, '');
    if (!h) return null;
    const m = h.match(/period=([a-z_0-9]+)/i);
    return m ? m[1] : null;
  }

  function writeHashPeriod(p) {
    const newHash = `period=${p}`;
    if (window.location.hash.replace(/^#/, '') === newHash) return;
    history.replaceState(null, '', '#' + newHash);
  }

  function readLS(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function writeLS(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* noop */ }
  }

  // ──────────────────────────────────────────
  // FETCH
  // ──────────────────────────────────────────
  async function fetchAndRender() {
    state.loading = true;
    state.error = null;
    renderSkeleton();

    // Abort previous request
    if (currentController) currentController.abort();
    currentController = new AbortController();
    const reqId = ++currentRequestId;

    const url = buildFetchUrl(state.period);

    try {
      const res = await fetch(url, {
        signal: currentController.signal,
        headers: { 'Accept': 'application/json' }
      });

      if (reqId !== currentRequestId) return;

      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }

      const data = await res.json();

      if (reqId !== currentRequestId) return;

      state.data = data;
      state.loading = false;
      state.error = null;
      renderAll();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (reqId !== currentRequestId) return;

      console.warn('[inmobili-home] fetch error', err);
      state.error = err.message || 'Error desconocido';
      state.loading = false;
      renderError();
    }
  }

  function buildFetchUrl(period) {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

    if (isLocal) {
      // CORS bloquea localhost contra Worker — usa fixture
      return FIXTURE_PATH + '?_=' + Date.now();
    }

    return `${ENDPOINT_BASE}?client=${CLIENT}&view=${VIEW}&period=${period}`;
  }

  // ──────────────────────────────────────────
  // RENDER — orchestrator
  // ──────────────────────────────────────────
  function renderAll() {
    if (!state.data) return;
    renderGoalsBanner();
    renderHeroLeft();
    renderHeroRight();
    renderKpiRow();
    renderCacRow();
    renderTodayStrip();
    renderPlazaCards();
    renderFooterMeta();
  }

  function renderSkeleton() {
    document.querySelectorAll('[data-skel]').forEach(el => {
      el.textContent = '—';
      el.classList.add('loading');
    });
  }

  function renderError() {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    banner.style.display = 'flex';
    banner.querySelector('.error-text').textContent =
      `No se pudo cargar el dashboard. ${state.error}`;
  }

  function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.style.display = 'none';
  }

  // ──────────────────────────────────────────
  // RENDER — sections
  // ──────────────────────────────────────────
  function renderGoalsBanner() {
    hideError();
    const d = state.data;
    const periodLabel = formatPeriodLabel(d.meta.period);
    setText('goals-banner-period', periodLabel);

    if (state.mode === 'captaciones') {
      setText('goals-banner-meta-1',
        `<strong>${fmtInt(d.goals.captaciones_meta)}</strong> captaciones meta`);
      setText('goals-banner-meta-2',
        `<strong>${fmtInt(d.goals.cierres_meta)}</strong> cierres meta`);
      setText('goals-banner-meta-3',
        `CAC target <strong>${fmtMxn(d.goals.cac_meta)}</strong>`);
    } else {
      setText('goals-banner-meta-1',
        `<strong>${fmtMxnShort(d.goals.venta_meta)}</strong> venta meta`);
      setText('goals-banner-meta-2',
        `<strong>${fmtInt(d.goals.cierres_meta)}</strong> cierres meta`);
      setText('goals-banner-meta-3',
        `Ticket promedio <strong>${fmtMxn(d.totals.current.ticket_promedio)}</strong>`);
    }
  }

  function renderHeroLeft() {
    const d = state.data;
    const card = document.getElementById('hero-left');
    if (!card) return;

    // Scope data by plaza
    const scoped = scopeData(d, state.plaza);

    if (state.mode === 'captaciones') {
      const real = scoped.current.captaciones;
      const goalMes = scoped.goals.captaciones_meta;
      const goalProrrated = state.plaza === 'all'
        ? d.goals_prorrated.captaciones_goal_periodo
        : (goalMes * (d.meta.period.days / daysInMonth(d.meta.period.to)));
      const delta = real - goalProrrated;
      const pct = goalMes > 0 ? (real / goalMes) * 100 : 0;

      card.innerHTML = renderHeroCard({
        label: 'Captaciones vs Meta',
        value: fmtInt(real),
        unit: 'captaciones',
        expected: fmtIntRound(goalProrrated),
        goal: fmtInt(goalMes),
        progressPct: Math.min(pct, 100),
        expectedPct: Math.min((goalProrrated / goalMes) * 100, 100),
        delta: delta,
        deltaLabel: delta >= 0 ? 'on pace' : `${Math.abs(Math.round(delta))} atrás`
      });
    } else {
      const real = scoped.current.venta;
      const goalMes = scoped.goals.venta_meta;
      const goalProrrated = state.plaza === 'all'
        ? d.goals_prorrated.venta_goal_periodo
        : (goalMes * (d.meta.period.days / daysInMonth(d.meta.period.to)));
      const delta = real - goalProrrated;
      const pct = goalMes > 0 ? (real / goalMes) * 100 : 0;

      card.innerHTML = renderHeroCard({
        label: 'Venta vs Meta',
        value: fmtMxnShort(real),
        unit: 'MXN',
        expected: fmtMxnShort(goalProrrated),
        goal: fmtMxnShort(goalMes),
        progressPct: Math.min(pct, 100),
        expectedPct: Math.min((goalProrrated / goalMes) * 100, 100),
        delta: delta,
        deltaLabel: delta >= 0 ? 'on pace' : `${fmtMxnShort(Math.abs(delta))} atrás`
      });
    }
  }

  function renderHeroCard(o) {
    const deltaClass = o.delta >= 0 ? 'positive' : 'negative';
    const arrow = o.delta >= 0 ? '↗' : '↘';
    return `
      <div class="hero-card-delta ${deltaClass}">${arrow} ${o.deltaLabel}</div>
      <div class="hero-card-label">${o.label}</div>
      <div class="hero-card-main">
        <div class="hero-card-value">${o.value}</div>
        <div class="hero-card-unit">${o.unit}</div>
      </div>
      <div class="hero-card-bar-wrap">
        <div class="hero-card-progress">
          <div class="hero-card-progress-fill" style="width: ${o.progressPct}%"></div>
          <div class="hero-card-progress-expected" style="left: ${o.expectedPct}%"></div>
        </div>
        <div class="hero-card-meta">
          <div class="hero-card-expected">${o.expected}</div>
          <div class="hero-card-expected-label">Expected</div>
        </div>
        <div class="hero-card-goal">/ ${o.goal}</div>
      </div>
    `;
  }

  function renderHeroRight() {
    const d = state.data;
    const card = document.getElementById('hero-right');
    if (!card) return;
    const scoped = scopeData(d, state.plaza);

    const spend = scoped.current.inversion_meta_ads;
    const hasSpend = spend !== null && spend !== undefined;

    if (!hasSpend) {
      card.innerHTML = `
        <div class="hero-card-label">Inversión Meta Ads</div>
        <div class="hero-card-main">
          <div class="hero-card-value" style="color: var(--text-muted)">—</div>
          <div class="hero-card-unit">pendiente</div>
        </div>
        <div class="hero-card-bar-wrap">
          <div style="color: var(--text-muted); font-size: 12px;">
            Atribución Meta migra S79 (sprint siguiente)
          </div>
        </div>
      `;
      return;
    }

    // Render con spend real (cuando fb-spend-sync esté live)
    const projected = projectEom(spend, d.meta.period.days, daysInMonth(d.meta.period.to));
    card.innerHTML = `
      <div class="hero-card-label">Inversión vs Plan</div>
      <div class="hero-card-main">
        <div class="hero-card-value">${fmtMxnShort(spend)}</div>
        <div class="hero-card-unit">MXN</div>
      </div>
      <div class="hero-card-bar-wrap">
        <div class="hero-card-meta">
          <div class="hero-card-expected">${fmtMxnShort(projected)}</div>
          <div class="hero-card-expected-label">Projected EOM</div>
        </div>
      </div>
    `;
  }

  function renderKpiRow() {
    const d = state.data;
    const scoped = scopeData(d, state.plaza);
    const today = d.totals.today; // today aggregated (no plaza split en shape v3)

    // KPI 1: Citas Agendadas Hoy
    setHtml('kpi-citas-today',
      `<div class="kpi-card-label">Citas Agendadas Hoy</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${fmtInt(today.citas_agendadas)}</div>
       </div>
       <div class="kpi-card-sub muted">Tiempo real</div>`);

    // KPI 2: Citas Agendadas Avg MTD
    const days = d.meta.period.days || 1;
    const avgCitas = scoped.current.citas_agendadas / days;
    setHtml('kpi-citas-avg',
      `<div class="kpi-card-label">Citas Agendadas Avg</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${avgCitas.toFixed(1)}</div>
       </div>
       <div class="kpi-card-sub muted">por día (MTD)</div>`);

    // KPI 3: Citas EOM proyectadas
    const totalDays = daysInMonth(d.meta.period.to);
    const eomCitas = Math.round(avgCitas * totalDays);
    setHtml('kpi-citas-eom',
      `<div class="kpi-card-label">Citas Proyectadas EOM</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${eomCitas}</div>
       </div>
       <div class="kpi-card-sub muted">si mantiene ritmo</div>`);

    // KPI 4: Cierres MTD
    setHtml('kpi-cierres',
      `<div class="kpi-card-label">Cierres MTD</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${fmtInt(scoped.current.cierres)}</div>
         <div class="kpi-card-sub">/ ${fmtInt(scoped.goals.cierres_meta)} meta</div>
       </div>
       <div class="kpi-card-sub muted">${(scoped.vs_goal.cierres_pct || 0).toFixed(1)}% del mes</div>`);
  }

  function renderCacRow() {
    const d = state.data;
    const scoped = scopeData(d, state.plaza);

    const cacCaptacion = scoped.current.cac;
    const captaciones = scoped.current.captaciones;
    const cacMeta = scoped.goals.cac_meta;

    // CAC Captación blended
    const c1 = document.getElementById('cac-captacion');
    if (c1) {
      c1.innerHTML = `
        <div class="cac-card-info">
          <div class="cac-card-label">CAC Captación (blended)</div>
          <div class="cac-card-meta">
            ${fmtInt(captaciones)} captaciones · Target ${fmtMxn(cacMeta)}
          </div>
        </div>
        <div class="cac-card-value ${cacCaptacion === null ? 'null-state' : ''}">
          ${cacCaptacion === null ? '—' : fmtMxn(cacCaptacion)}
        </div>
      `;
    }

    // CAC Cita Agendada blended
    const citas = scoped.current.citas_agendadas;
    const cacCita = (cacCaptacion === null || citas === 0) ? null : (scoped.current.inversion_meta_ads / citas);
    const c2 = document.getElementById('cac-cita');
    if (c2) {
      c2.innerHTML = `
        <div class="cac-card-info">
          <div class="cac-card-label">CAC Cita Agendada (blended)</div>
          <div class="cac-card-meta">${fmtInt(citas)} citas agendadas MTD</div>
        </div>
        <div class="cac-card-value ${cacCita === null ? 'null-state' : ''}">
          ${cacCita === null ? '—' : fmtMxn(cacCita)}
        </div>
      `;
    }
  }

  function renderTodayStrip() {
    const d = state.data;
    const today = d.totals.today;
    const strip = document.getElementById('today-stats');
    if (!strip) return;
    strip.innerHTML = `
      <div class="today-strip-stat">
        <div class="today-strip-stat-value">${fmtInt(today.captaciones)}</div>
        <div class="today-strip-stat-label">Captaciones</div>
      </div>
      <div class="today-strip-stat">
        <div class="today-strip-stat-value">${fmtInt(today.citas_agendadas)}</div>
        <div class="today-strip-stat-label">Citas Agendadas</div>
      </div>
      <div class="today-strip-stat">
        <div class="today-strip-stat-value">${fmtInt(today.cierres)}</div>
        <div class="today-strip-stat-label">Cierres</div>
      </div>
    `;
  }

  function renderPlazaCards() {
    const d = state.data;
    const container = document.getElementById('plaza-grid');
    if (!container) return;

    if (state.plaza !== 'all') {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    container.innerHTML = ['torreon', 'gomez'].map(key => {
      const plaza = d.by_plaza[key];
      return renderPlazaCard(key, plaza);
    }).join('');
  }

  function renderPlazaCard(key, plaza) {
    const c = plaza.current;
    const g = plaza.goals;
    const vs = plaza.vs_goal;

    const cacNull = c.cac === null;

    return `
      <div class="plaza-card">
        <div class="plaza-card-header">
          <div class="plaza-card-title">${PLAZA_LABELS[key] || key.toUpperCase()}</div>
          <div class="plaza-card-title-meta">META ${fmtMxnShort(g.venta_meta)}</div>
        </div>
        <div class="plaza-card-rows">
          <div class="plaza-card-row ${c.inversion_meta_ads === null ? 'null-state' : ''}">
            <div class="plaza-card-row-label">Inversión Meta</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${c.inversion_meta_ads === null ? '—' : fmtMxnShort(c.inversion_meta_ads)}</div>
            </div>
          </div>
          <div class="plaza-card-row">
            <div class="plaza-card-row-label">Citas Agendadas</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${fmtInt(c.citas_agendadas)}</div>
            </div>
          </div>
          <div class="plaza-card-row highlight">
            <div class="plaza-card-row-label">Captaciones</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${fmtInt(c.captaciones)}</div>
              <div class="plaza-card-row-value-meta">/ ${fmtInt(g.captaciones_meta)} (${(vs.captaciones_pct || 0).toFixed(0)}%)</div>
            </div>
          </div>
          <div class="plaza-card-row">
            <div class="plaza-card-row-label">Cierres</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${fmtInt(c.cierres)}</div>
              <div class="plaza-card-row-value-meta">/ ${fmtInt(g.cierres_meta)} (${(vs.cierres_pct || 0).toFixed(0)}%)</div>
            </div>
          </div>
          <div class="plaza-card-row">
            <div class="plaza-card-row-label">Venta</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${fmtMxnShort(c.venta)}</div>
              <div class="plaza-card-row-value-meta">/ ${fmtMxnShort(g.venta_meta)} (${(vs.venta_pct || 0).toFixed(0)}%)</div>
            </div>
          </div>
          <div class="plaza-card-row ${cacNull ? 'null-state' : ''}">
            <div class="plaza-card-row-label">CAC</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${cacNull ? '—' : fmtMxn(c.cac)}</div>
              <div class="plaza-card-row-value-meta">target ${fmtMxn(g.cac_meta)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderFooterMeta() {
    const d = state.data;
    setText('footer-period', formatPeriodLabel(d.meta.period));
    setText('footer-source', d.goals_source === 'firestore' ? 'Firestore' : 'Sheet');
    setText('footer-updated', new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
  }

  // ──────────────────────────────────────────
  // SCOPE BY PLAZA
  // ──────────────────────────────────────────
  function scopeData(d, plaza) {
    if (plaza === 'all') {
      return {
        current: d.totals.current,
        goals: d.goals,
        vs_goal: d.totals.vs_goal
      };
    }
    const p = d.by_plaza[plaza];
    if (!p) {
      return { current: d.totals.current, goals: d.goals, vs_goal: d.totals.vs_goal };
    }
    return {
      current: p.current,
      goals:   p.goals,
      vs_goal: p.vs_goal
    };
  }

  // ──────────────────────────────────────────
  // FORMATTERS
  // ──────────────────────────────────────────
  function fmtInt(n) {
    if (n === null || n === undefined) return '—';
    return Math.round(n).toLocaleString('es-MX');
  }

  function fmtIntRound(n) {
    if (n === null || n === undefined) return '—';
    return Math.round(n).toLocaleString('es-MX');
  }

  function fmtMxn(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('es-MX');
  }

  function fmtMxnShort(n) {
    if (n === null || n === undefined) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
    if (abs >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'K';
    return '$' + Math.round(n).toLocaleString('es-MX');
  }

  function formatPeriodLabel(p) {
    if (!p) return '';
    const months = {
      '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
      '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
      '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
    };
    const parts = (p.from || '').split('-');
    if (parts.length !== 3) return PERIOD_LABELS[p.kind] || p.kind;
    const monthLabel = months[parts[1]] + ' ' + parts[0];
    const kindLabel = PERIOD_LABELS[p.kind] || p.kind;
    return `${monthLabel} · ${kindLabel} (${p.days} días)`;
  }

  function daysInMonth(dateStr) {
    if (!dateStr) return 30;
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    return new Date(year, month, 0).getDate();
  }

  function projectEom(currentValue, daysElapsed, totalDays) {
    if (!daysElapsed) return currentValue;
    return (currentValue / daysElapsed) * totalDays;
  }

  // ──────────────────────────────────────────
  // DOM HELPERS
  // ──────────────────────────────────────────
  function setText(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ──────────────────────────────────────────
  // ERROR RETRY
  // ──────────────────────────────────────────
  window.__inmobiliRetry = function () {
    hideError();
    fetchAndRender();
  };

})();
