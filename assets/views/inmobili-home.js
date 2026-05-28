// ============================================
// INMOBILI HOME — Dashboard Optix
// v2 — Tier B LITE support (plaza split + daily diferidos)
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

  const ALL_PERIODS = ['today', 'yesterday', '7d', '30d', 'mtd', 'last_month'];
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
  const LS_MODE_KEY    = 'inmobili_home_mode';
  const LS_PLAZA_KEY   = 'inmobili_home_plaza';

  // ──────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────
  let state = {
    period:  DEFAULT_PERIOD,
    mode:    'captaciones',
    plaza:   'all',
    data:    null,
    isLite:  false,
    loading: false,
    error:   null
  };

  let currentController = null;
  let currentRequestId = 0;

  // ──────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    state.period = readPeriodFromHash() || readLS(LS_PERIOD_KEY, DEFAULT_PERIOD);
    state.mode   = readLS(LS_MODE_KEY, 'captaciones');
    state.plaza  = readLS(LS_PLAZA_KEY, 'all');

    if (!ALL_PERIODS.includes(state.period)) state.period = DEFAULT_PERIOD;
    if (!['captaciones', 'venta'].includes(state.mode)) state.mode = 'captaciones';
    if (!['all', 'torreon', 'gomez'].includes(state.plaza)) state.plaza = 'all';

    bindPeriodChips();
    bindModeToggle();
    bindPlazaSelect();
    bindHashListener();

    syncControlsToState();
    fetchAndRender();
  }

  // ──────────────────────────────────────────
  // CONTROLS
  // ──────────────────────────────────────────
  function bindPeriodChips() {
    document.querySelectorAll('.period-chip').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('disabled') || el.disabled) return;
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
        if (state.data) {
          renderHeroLeft();
          renderGoalsBanner();
        }
      });
    });
  }

  function bindPlazaSelect() {
    const sel = document.getElementById('plaza-select');
    if (!sel) return;
    sel.addEventListener('change', e => {
      if (sel.disabled) return;
      const p = e.target.value;
      if (state.plaza === p) return;
      state.plaza = p;
      writeLS(LS_PLAZA_KEY, p);
      if (state.data) renderAll();
    });
  }

  function bindHashListener() {
    window.addEventListener('hashchange', () => {
      const p = readPeriodFromHash();
      if (p && p !== state.period && ALL_PERIODS.includes(p)) {
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
  // HASH + LS
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

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();

      if (reqId !== currentRequestId) return;

      state.data = data;
      state.isLite = isLiteShape(data);
      state.loading = false;
      state.error = null;
      hideError();
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
    if (isLocal) return FIXTURE_PATH + '?_=' + Date.now();
    return `${ENDPOINT_BASE}?client=${CLIENT}&view=${VIEW}&period=${period}`;
  }

  // ──────────────────────────────────────────
  // SHAPE DETECTION
  // ──────────────────────────────────────────
  function isLiteShape(d) {
    if (!d) return false;
    if (d.meta && d.meta.tier === 'B_lite') return true;
    // Fallback detection: si no hay by_plaza ni today, asumimos LITE
    if (!d.by_plaza && (!d.totals || !d.totals.today)) return true;
    return false;
  }

  // ──────────────────────────────────────────
  // RENDER ORCHESTRATOR
  // ──────────────────────────────────────────
  function renderAll() {
    if (!state.data) return;
    const d = state.data;

    // Configurar UI según tier
    if (state.isLite) {
      disableUnavailablePeriods();
      disablePlazaSelector();
    }

    renderTierBadge();
    renderGoalsBanner();
    renderHeroLeft();
    renderHeroRight();
    renderKpiRow();
    renderCacRow();

    if (state.isLite || !get(d, 'totals.today')) {
      renderTodayPlaceholder();
    } else {
      renderTodayStrip();
    }

    if (state.isLite || !d.by_plaza) {
      renderPlazaPlaceholder();
    } else {
      renderPlazaCards();
    }

    renderFooterMeta();
  }

  function renderError() {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    banner.style.display = 'flex';
    const txt = banner.querySelector('.error-text');
    if (txt) txt.textContent = `No se pudo cargar el dashboard. ${state.error}`;
  }

  function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.style.display = 'none';
  }

  // ──────────────────────────────────────────
  // TIER BADGE
  // ──────────────────────────────────────────
  function renderTierBadge() {
    const badge = document.getElementById('tier-badge');
    if (!badge) return;
    if (state.isLite) {
      const disclaimer = get(state.data, 'meta.tier_b_lite_disclaimer') ||
        'Vista preliminar — métricas adicionales próximamente.';
      badge.style.display = 'inline-flex';
      badge.title = disclaimer;
      badge.querySelector('.tier-badge-text').textContent = 'Vista preliminar';
    } else {
      badge.style.display = 'none';
    }
  }

  // ──────────────────────────────────────────
  // GRACEFUL DEGRADATION
  // ──────────────────────────────────────────
  function disableUnavailablePeriods() {
    const available = get(state.data, 'meta.available_periods') || ['mtd', 'last_month'];
    document.querySelectorAll('.period-chip').forEach(el => {
      const p = el.dataset.period;
      if (!available.includes(p)) {
        el.classList.add('disabled');
        el.disabled = true;
        el.title = 'Disponible próximamente';
      } else {
        el.classList.remove('disabled');
        el.disabled = false;
        el.removeAttribute('title');
      }
    });
    // Si el período activo no es válido, forzar default
    if (!available.includes(state.period)) {
      state.period = DEFAULT_PERIOD;
      writeLS(LS_PERIOD_KEY, state.period);
      syncPeriodChips();
    }
  }

  function disablePlazaSelector() {
    const sel = document.getElementById('plaza-select');
    if (!sel) return;
    Array.from(sel.options).forEach(opt => {
      if (opt.value !== 'all') {
        opt.disabled = true;
        if (!opt.text.includes('(próximamente)')) {
          opt.text = opt.text + ' (próximamente)';
        }
      }
    });
    sel.value = 'all';
    sel.title = 'Vista por plaza próximamente';
    state.plaza = 'all';
    writeLS(LS_PLAZA_KEY, 'all');
  }

  function renderTodayPlaceholder() {
    const strip = document.getElementById('today-strip');
    if (!strip) return;
    strip.innerHTML = `
      <div class="today-strip-title">Hoy</div>
      <div class="today-strip-placeholder">
        Métricas del día disponibles en próxima iteración.
      </div>
    `;
    strip.classList.add('placeholder');
  }

  function renderPlazaPlaceholder() {
    const container = document.getElementById('plaza-grid');
    if (!container) return;
    container.innerHTML = `
      <div class="plaza-placeholder">
        <div class="plaza-placeholder-tag">Próximamente</div>
        <div class="plaza-placeholder-title">Vista por Plaza</div>
        <div class="plaza-placeholder-sub">
          Desglose Torreón &middot; Gómez Palacios en próxima iteración
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────
  // GOALS BANNER
  // ──────────────────────────────────────────
  function renderGoalsBanner() {
    const d = state.data;
    if (!d) return;
    const periodLabel = formatPeriodLabel(get(d, 'meta.period'));
    setHtml('goals-banner-period', periodLabel);

    const goals = d.goals || {};
    const ticketProm = get(d, 'totals.current.ticket_promedio');

    if (state.mode === 'captaciones') {
      setHtml('goals-banner-meta-1',
        `<strong>${fmtInt(goals.captaciones_meta)}</strong> captaciones meta`);
      setHtml('goals-banner-meta-2',
        `<strong>${fmtInt(goals.cierres_meta)}</strong> cierres meta`);
      setHtml('goals-banner-meta-3',
        `CAC target <strong>${fmtMxn(goals.cac_meta)}</strong>`);
    } else {
      setHtml('goals-banner-meta-1',
        `<strong>${fmtMxnShort(goals.venta_meta)}</strong> venta meta`);
      setHtml('goals-banner-meta-2',
        `<strong>${fmtInt(goals.cierres_meta)}</strong> cierres meta`);
      setHtml('goals-banner-meta-3',
        `Ticket promedio <strong>${ticketProm ? fmtMxn(ticketProm) : '—'}</strong>`);
    }
  }

  // ──────────────────────────────────────────
  // HERO LEFT (Captaciones / Venta vs Meta)
  // ──────────────────────────────────────────
  function renderHeroLeft() {
    const d = state.data;
    if (!d) return;
    const card = document.getElementById('hero-left');
    if (!card) return;

    const scoped = scopeData(d, state.plaza);
    const current = scoped.current || {};
    const goals = scoped.goals || {};
    const periodDays = get(d, 'meta.period.days') || 1;
    const totalDays = daysInMonth(get(d, 'meta.period.to'));

    if (state.mode === 'captaciones') {
      const real = current.captaciones || 0;
      const goalMes = goals.captaciones_meta || 0;
      let goalProrrated;
      if (state.plaza === 'all') {
        goalProrrated = get(d, 'goals_prorrated.captaciones_goal_periodo')
          || (goalMes * (periodDays / totalDays));
      } else {
        goalProrrated = goalMes * (periodDays / totalDays);
      }
      const delta = real - goalProrrated;
      const pct = goalMes > 0 ? (real / goalMes) * 100 : 0;
      const expectedPct = goalMes > 0 ? Math.min((goalProrrated / goalMes) * 100, 100) : 0;

      card.innerHTML = renderHeroCard({
        label: 'Captaciones vs Meta',
        value: fmtInt(real),
        unit: 'captaciones',
        expected: fmtIntRound(goalProrrated),
        goal: fmtInt(goalMes),
        progressPct: Math.min(pct, 100),
        expectedPct: expectedPct,
        delta: delta,
        deltaLabel: delta >= 0 ? 'on pace' : `${Math.abs(Math.round(delta))} atrás`
      });
    } else {
      const real = current.venta || 0;
      const goalMes = goals.venta_meta || 0;
      let goalProrrated;
      if (state.plaza === 'all') {
        goalProrrated = get(d, 'goals_prorrated.venta_goal_periodo')
          || (goalMes * (periodDays / totalDays));
      } else {
        goalProrrated = goalMes * (periodDays / totalDays);
      }
      const delta = real - goalProrrated;
      const pct = goalMes > 0 ? (real / goalMes) * 100 : 0;
      const expectedPct = goalMes > 0 ? Math.min((goalProrrated / goalMes) * 100, 100) : 0;

      card.innerHTML = renderHeroCard({
        label: 'Venta vs Meta',
        value: fmtMxnShort(real),
        unit: 'MXN',
        expected: fmtMxnShort(goalProrrated),
        goal: fmtMxnShort(goalMes),
        progressPct: Math.min(pct, 100),
        expectedPct: expectedPct,
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

  // ──────────────────────────────────────────
  // HERO RIGHT (Inversión)
  // ──────────────────────────────────────────
  function renderHeroRight() {
    const d = state.data;
    if (!d) return;
    const card = document.getElementById('hero-right');
    if (!card) return;

    const scoped = scopeData(d, state.plaza);
    const spend = get(scoped, 'current.inversion_meta_ads');
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
            Atribución por canal en próxima iteración
          </div>
        </div>
      `;
      return;
    }

    const periodDays = get(d, 'meta.period.days') || 1;
    const totalDays = daysInMonth(get(d, 'meta.period.to'));
    const projected = projectEom(spend, periodDays, totalDays);
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

  // ──────────────────────────────────────────
  // KPI ROW
  // ──────────────────────────────────────────
  function renderKpiRow() {
    const d = state.data;
    if (!d) return;
    const scoped = scopeData(d, state.plaza);
    const current = scoped.current || {};
    const goals = scoped.goals || {};
    const today = get(d, 'totals.today') || {};

    const periodDays = get(d, 'meta.period.days') || 1;
    const totalDays = daysInMonth(get(d, 'meta.period.to'));

    // KPI 1: Citas Hoy — LITE muestra placeholder
    if (state.isLite || !get(d, 'totals.today')) {
      setHtml('kpi-citas-today',
        `<div class="kpi-card-label">Citas Hoy</div>
         <div class="kpi-card-main">
           <div class="kpi-card-value" style="color: var(--text-muted)">—</div>
         </div>
         <div class="kpi-card-sub muted">Próxima iteración</div>`);
    } else {
      setHtml('kpi-citas-today',
        `<div class="kpi-card-label">Citas Agendadas Hoy</div>
         <div class="kpi-card-main">
           <div class="kpi-card-value">${fmtInt(today.citas_agendadas)}</div>
         </div>
         <div class="kpi-card-sub muted">Tiempo real</div>`);
    }

    // KPI 2: Citas Avg MTD
    const citasAgendadas = current.citas_agendadas || 0;
    const avgCitas = citasAgendadas / periodDays;
    setHtml('kpi-citas-avg',
      `<div class="kpi-card-label">Citas Agendadas Avg</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${avgCitas.toFixed(1)}</div>
       </div>
       <div class="kpi-card-sub muted">por día (MTD)</div>`);

    // KPI 3: Citas EOM proyectadas
    const eomCitas = Math.round(avgCitas * totalDays);
    setHtml('kpi-citas-eom',
      `<div class="kpi-card-label">Citas Proyectadas EOM</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${eomCitas}</div>
       </div>
       <div class="kpi-card-sub muted">si mantiene ritmo</div>`);

    // KPI 4: Cierres MTD
    const vsGoalCierres = get(scoped, 'vs_goal.cierres_pct');
    setHtml('kpi-cierres',
      `<div class="kpi-card-label">Cierres MTD</div>
       <div class="kpi-card-main">
         <div class="kpi-card-value">${fmtInt(current.cierres)}</div>
         <div class="kpi-card-sub">/ ${fmtInt(goals.cierres_meta)} meta</div>
       </div>
       <div class="kpi-card-sub muted">${vsGoalCierres !== null && vsGoalCierres !== undefined ? vsGoalCierres.toFixed(1) : '0.0'}% del mes</div>`);
  }

  // ──────────────────────────────────────────
  // CAC ROW
  // ──────────────────────────────────────────
  function renderCacRow() {
    const d = state.data;
    if (!d) return;
    const scoped = scopeData(d, state.plaza);
    const current = scoped.current || {};
    const goals = scoped.goals || {};

    const cacCaptacion = current.cac;
    const captaciones = current.captaciones || 0;
    const cacMeta = goals.cac_meta;
    const inversion = current.inversion_meta_ads;
    const citas = current.citas_agendadas || 0;

    const c1 = document.getElementById('cac-captacion');
    if (c1) {
      const cacNull = cacCaptacion === null || cacCaptacion === undefined;
      c1.innerHTML = `
        <div class="cac-card-info">
          <div class="cac-card-label">CAC Captación (blended)</div>
          <div class="cac-card-meta">
            ${fmtInt(captaciones)} captaciones${cacMeta ? ` · Target ${fmtMxn(cacMeta)}` : ''}
          </div>
        </div>
        <div class="cac-card-value ${cacNull ? 'null-state' : ''}">
          ${cacNull ? '—' : fmtMxn(cacCaptacion)}
        </div>
      `;
    }

    const c2 = document.getElementById('cac-cita');
    if (c2) {
      const cacCita = (inversion === null || inversion === undefined || citas === 0)
        ? null
        : (inversion / citas);
      const cacCitaNull = cacCita === null;
      c2.innerHTML = `
        <div class="cac-card-info">
          <div class="cac-card-label">CAC Cita Agendada (blended)</div>
          <div class="cac-card-meta">${fmtInt(citas)} citas agendadas MTD</div>
        </div>
        <div class="cac-card-value ${cacCitaNull ? 'null-state' : ''}">
          ${cacCitaNull ? '—' : fmtMxn(cacCita)}
        </div>
      `;
    }
  }

  // ──────────────────────────────────────────
  // TODAY STRIP (solo si no LITE)
  // ──────────────────────────────────────────
  function renderTodayStrip() {
    const d = state.data;
    if (!d) return;
    const today = get(d, 'totals.today') || {};
    const strip = document.getElementById('today-strip');
    if (!strip) return;

    strip.classList.remove('placeholder');
    strip.innerHTML = `
      <div class="today-strip-title">Hoy</div>
      <div id="today-stats" class="today-strip-stats">
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
      </div>
    `;
  }

  // ──────────────────────────────────────────
  // PLAZA CARDS (solo si no LITE)
  // ──────────────────────────────────────────
  function renderPlazaCards() {
    const d = state.data;
    if (!d || !d.by_plaza) return;
    const container = document.getElementById('plaza-grid');
    if (!container) return;

    if (state.plaza !== 'all') {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    container.innerHTML = ['torreon', 'gomez'].map(key => {
      const plaza = d.by_plaza[key];
      if (!plaza) return '';
      return renderPlazaCard(key, plaza);
    }).join('');
  }

  function renderPlazaCard(key, plaza) {
    const c = plaza.current || {};
    const g = plaza.goals || {};
    const vs = plaza.vs_goal || {};
    const cacNull = c.cac === null || c.cac === undefined;
    const inversionNull = c.inversion_meta_ads === null || c.inversion_meta_ads === undefined;

    return `
      <div class="plaza-card">
        <div class="plaza-card-header">
          <div class="plaza-card-title">${PLAZA_LABELS[key] || key.toUpperCase()}</div>
          <div class="plaza-card-title-meta">META ${fmtMxnShort(g.venta_meta)}</div>
        </div>
        <div class="plaza-card-rows">
          <div class="plaza-card-row ${inversionNull ? 'null-state' : ''}">
            <div class="plaza-card-row-label">Inversión Meta</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${inversionNull ? '—' : fmtMxnShort(c.inversion_meta_ads)}</div>
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
              <div class="plaza-card-row-value-meta">/ ${fmtInt(g.captaciones_meta)} (${fmtPct(vs.captaciones_pct)})</div>
            </div>
          </div>
          <div class="plaza-card-row">
            <div class="plaza-card-row-label">Cierres</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${fmtInt(c.cierres)}</div>
              <div class="plaza-card-row-value-meta">/ ${fmtInt(g.cierres_meta)} (${fmtPct(vs.cierres_pct)})</div>
            </div>
          </div>
          <div class="plaza-card-row">
            <div class="plaza-card-row-label">Venta</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${fmtMxnShort(c.venta)}</div>
              <div class="plaza-card-row-value-meta">/ ${fmtMxnShort(g.venta_meta)} (${fmtPct(vs.venta_pct)})</div>
            </div>
          </div>
          <div class="plaza-card-row ${cacNull ? 'null-state' : ''}">
            <div class="plaza-card-row-label">CAC</div>
            <div class="plaza-card-row-value">
              <div class="plaza-card-row-value-main">${cacNull ? '—' : fmtMxn(c.cac)}</div>
              <div class="plaza-card-row-value-meta">${g.cac_meta ? 'target ' + fmtMxn(g.cac_meta) : ''}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────
  // FOOTER
  // ──────────────────────────────────────────
  function renderFooterMeta() {
    const d = state.data;
    if (!d) return;
    setText('footer-period', formatPeriodLabel(get(d, 'meta.period')));
    const src = d.goals_source === 'firestore' ? 'Firestore' :
                d.goals_source === 'sheet' ? 'Sheet' : '—';
    setText('footer-source', src);
    setText('footer-updated', new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
  }

  // ──────────────────────────────────────────
  // SCOPE BY PLAZA
  // ──────────────────────────────────────────
  function scopeData(d, plaza) {
    // En LITE o sin by_plaza: siempre retorna totals
    if (!d.by_plaza || plaza === 'all') {
      return {
        current: get(d, 'totals.current') || {},
        goals: d.goals || {},
        vs_goal: get(d, 'totals.vs_goal') || {}
      };
    }
    const p = d.by_plaza[plaza];
    if (!p) {
      return {
        current: get(d, 'totals.current') || {},
        goals: d.goals || {},
        vs_goal: get(d, 'totals.vs_goal') || {}
      };
    }
    return {
      current: p.current || {},
      goals:   p.goals   || {},
      vs_goal: p.vs_goal || {}
    };
  }

  // ──────────────────────────────────────────
  // FORMATTERS
  // ──────────────────────────────────────────
  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('es-MX');
  }

  function fmtIntRound(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('es-MX');
  }

  function fmtMxn(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('es-MX');
  }

  function fmtMxnShort(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
    if (abs >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'K';
    return '$' + Math.round(n).toLocaleString('es-MX');
  }

  function fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return '0%';
    return n.toFixed(0) + '%';
  }

  function formatPeriodLabel(p) {
    if (!p) return '';
    const months = {
      '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
      '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
      '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
    };
    const parts = (p.from || '').split('-');
    if (parts.length !== 3) return PERIOD_LABELS[p.kind] || p.kind || '—';
    const monthLabel = (months[parts[1]] || parts[1]) + ' ' + parts[0];
    const kindLabel = PERIOD_LABELS[p.kind] || p.kind || '';
    const days = p.days ? ` (${p.days} días)` : '';
    return `${monthLabel} · ${kindLabel}${days}`;
  }

  function daysInMonth(dateStr) {
    if (!dateStr) return 30;
    const parts = dateStr.split('-');
    if (parts.length < 2) return 30;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(month)) return 30;
    return new Date(year, month, 0).getDate();
  }

  function projectEom(currentValue, daysElapsed, totalDays) {
    if (!daysElapsed) return currentValue;
    return (currentValue / daysElapsed) * totalDays;
  }

  // ──────────────────────────────────────────
  // HELPERS — safe property access
  // ──────────────────────────────────────────
  function get(obj, path) {
    if (!obj) return undefined;
    return path.split('.').reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, obj);
  }

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ──────────────────────────────────────────
  // RETRY HOOK
  // ──────────────────────────────────────────
  window.__inmobiliRetry = function () {
    hideError();
    fetchAndRender();
  };

})();
