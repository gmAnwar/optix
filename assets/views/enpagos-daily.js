/**
 * EnPagos Daily — sticky bar + temporal filters, Sprint 2a.
 *
 * Public API:
 *   EnPagosDaily.mount(rootElement)
 *
 * Fetch: GET /client_data_public?view=daily&period=<slug>
 *   - AbortController: each fetchDaily cancels any in-flight request.
 *   - Retry: only for 503 data_not_ready, backoff 1s/2s/4s, cap 3 intentos.
 *   - Other 4xx/5xx: immediate reject, danger banner.
 *   - Timeout: 10s (aborts via controller).
 *
 * URL state: ?period=<slug> on mount, history.replaceState on dropdown change.
 *
 * // [S52-CONTRACT] Endpoint shape documented in canvas F0AU85FCLD7.
 * // top-level = meta, goals, goals_prorrated, totals, by_city.
 * // totals.delta.*_pct are decimals (multiply ×100 before render).
 * // totals.vs_goal.cac_status ∈ {red, amber, green, null}.
 * // For CAC / costo_preaut_positivo, delta color is INVERTED (up = bad).
 */
(function () {
  var ENDPOINT = 'https://optix-proxy.anwarhsg.workers.dev/client_data_public';

  var PERIOD_OPTIONS = [
    { value: 'today',     label: 'Hoy (parcial)' },
    { value: 'yesterday', label: 'Ayer' },
    { value: '7d',        label: 'Últimos 7 días' },
    { value: '30d',       label: 'Últimos 30 días' },
    { value: 'mtd',       label: 'Mes actual (MTD)' }
  ];
  var VALID_PERIODS = PERIOD_OPTIONS.reduce(function (m, o) { m[o.value] = 1; return m; }, {});
  var DEFAULT_PERIOD = 'mtd';

  var RETRY_DELAYS_MS = [1000, 2000, 4000];
  var FETCH_TIMEOUT_MS = 10000;

  var state = {
    root: null,
    period: DEFAULT_PERIOD,
    data: null,
    controller: null,
    hasRenderedOnce: false
  };

  // ── Formatters ────────────────────────────────────────────────────────
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '—';
    return '$' + Math.round(v).toLocaleString('es-MX');
  }

  function fmtMoneyK(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 10000)   return '$' + Math.round(v / 1000) + 'K';
    return '$' + Math.round(v).toLocaleString('es-MX');
  }

  function fmtNum(v) {
    if (v == null || isNaN(v)) return '—';
    return Math.round(v).toLocaleString('es-MX');
  }

  // Signed percentage from decimal delta (×100, 1 decimal place).
  function fmtDeltaPct(decimal) {
    if (decimal == null || isNaN(decimal)) return null;
    var pct = decimal * 100;
    var sign = pct > 0 ? '+' : (pct < 0 ? '' : '±');
    return sign + pct.toFixed(1) + '%';
  }

  function fmtDeltaAbs(n) {
    if (n == null || isNaN(n)) return null;
    var sign = n > 0 ? '+' : (n < 0 ? '' : '±');
    return sign + Math.round(n).toLocaleString('es-MX');
  }

  function arrowFor(n) {
    if (n == null || isNaN(n)) return '';
    if (n > 0) return '▲';
    if (n < 0) return '▼';
    return '—';
  }

  // Direct color: positive=good(green). Use for cierres/preaut+/inversion/venta/roas.
  function colorDirect(n) {
    if (n == null || isNaN(n) || n === 0) return 'flat';
    return n > 0 ? 'good' : 'bad';
  }

  // Inverted color: positive=bad(red). Use for CAC / costo_preaut_positivo.
  function colorInverted(n) {
    if (n == null || isNaN(n) || n === 0) return 'flat';
    return n > 0 ? 'bad' : 'good';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  // ── URL state ─────────────────────────────────────────────────────────
  function readPeriodFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search).get('period');
      if (p && VALID_PERIODS[p]) return p;
      if (p) console.warn('[daily] invalid period in URL:', p, '— falling back to', DEFAULT_PERIOD);
    } catch (e) { /* ignore */ }
    return DEFAULT_PERIOD;
  }

  function writePeriodToUrl(period) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('period', period);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  // ── Fetch with abort + 503 retry ─────────────────────────────────────
  function fetchDaily(period) {
    if (state.controller) state.controller.abort();
    var controller = new AbortController();
    state.controller = controller;

    var timeoutId = setTimeout(function () { controller.abort(new Error('timeout')); }, FETCH_TIMEOUT_MS);
    var attempt = 0;

    function tryOnce() {
      var url = ENDPOINT + '?view=daily&period=' + encodeURIComponent(period);
      return fetch(url, { signal: controller.signal }).then(function (r) {
        if (r.status === 503 && attempt < RETRY_DELAYS_MS.length) {
          var wait = RETRY_DELAYS_MS[attempt];
          attempt += 1;
          showRetryBanner(attempt, RETRY_DELAYS_MS.length + 1);
          return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(tryOnce);
        }
        if (!r.ok) {
          return r.json().then(function (body) {
            var err = new Error('http ' + r.status);
            err.status = r.status;
            err.body = body;
            throw err;
          }, function () {
            var err = new Error('http ' + r.status);
            err.status = r.status;
            throw err;
          });
        }
        return r.json();
      });
    }

    return tryOnce().finally(function () {
      clearTimeout(timeoutId);
      if (state.controller === controller) state.controller = null;
    });
  }

  // ── Render: skeleton (first load) ────────────────────────────────────
  function renderSkeleton() {
    var shell = [
      '<a class="daily-backlink" href="/enpagos-overview.html" aria-label="Volver a Overview">',
      '  <span aria-hidden="true">←</span>',
      '  <span>Overview</span>',
      '</a>',
      '<div class="daily-controls">',
      '  <label for="daily-period-select" class="sr-only">Periodo</label>',
      '  <select id="daily-period-select" class="daily-period-select" disabled>',
      PERIOD_OPTIONS.map(function (o) {
        return '    <option value="' + escapeHtml(o.value) + '"' + (o.value === state.period ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
      }).join('\n'),
      '  </select>',
      '  <span class="daily-freshness" id="daily-freshness" aria-live="polite"></span>',
      '</div>',
      '<div class="daily-sticky-wrapper">',
      '  <section class="daily-sticky" aria-label="Métricas clave">',
      '    <div class="daily-sticky__grid" id="daily-sticky-grid">',
      ['Inversión','Cierres','CAC','Preaut+'].map(function (label) {
        return ''
          + '<div class="daily-kpi daily-kpi--skeleton" aria-hidden="true">'
          +   '<div class="daily-kpi__head">'
          +     '<div class="daily-kpi__skeleton-line daily-kpi__skeleton-line--title"></div>'
          +   '</div>'
          +   '<div class="daily-kpi__skeleton-line daily-kpi__skeleton-line--value"></div>'
          +   '<div class="daily-kpi__skeleton-line daily-kpi__skeleton-line--sub"></div>'
          + '</div>';
      }).join(''),
      '    </div>',
      '  </section>',
      '</div>',
      '<div class="daily-banners" id="daily-banners" aria-live="polite"></div>',
      '<div id="daily-view-root"></div>'
    ].join('\n');

    state.root.innerHTML = shell;
    wireDropdown();
    updateSubtitle(null);
  }

  // ── Render: sticky bar from data ─────────────────────────────────────
  function renderStickyBar(data) {
    var current = (data && data.totals && data.totals.current) || {};
    var delta   = (data && data.totals && data.totals.delta) || {};
    var vsGoal  = (data && data.totals && data.totals.vs_goal) || {};
    var prorr   = (data && data.goals_prorrated) || {};

    // Cierres goal pretty-rounded (hide "N de 0" when pipeline pro-rates to 0).
    var cierresGoalRaw = prorr.cierres_goal_periodo;
    var cierresGoal = null;
    if (cierresGoalRaw != null && !isNaN(cierresGoalRaw) && cierresGoalRaw > 0) {
      cierresGoal = Math.max(1, Math.round(cierresGoalRaw));
    }

    // CAC: "—" when cierres === 0 (avoid divide-by-zero / $0 noise).
    var cacValue = (current.cierres === 0 || current.cierres == null)
      ? null
      : current.cac;

    var cells = [
      {
        label: 'Inversión',
        value: fmtMoneyK(current.inversion_total_meta_ads),
        rawValue: current.inversion_total_meta_ads,
        deltaText: fmtDeltaPct(delta.inversion_pct),
        deltaSrc:  delta.inversion_pct,
        deltaColor: colorDirect(delta.inversion_pct),
        sub: 'vs periodo anterior'
      },
      {
        label: 'Cierres',
        value: fmtNum(current.cierres),
        rawValue: current.cierres,
        deltaText: fmtDeltaAbs(delta.cierres_abs),
        deltaSrc:  delta.cierres_abs,
        deltaColor: colorDirect(delta.cierres_abs),
        sub: cierresGoal != null ? ('de ~' + cierresGoal) : 'meta pendiente'
      },
      {
        label: 'CAC',
        value: cacValue == null ? '—' : fmtMoney(cacValue),
        rawValue: cacValue,
        deltaText: cacValue == null ? null : fmtDeltaPct(delta.cac_pct),
        deltaSrc:  delta.cac_pct,
        deltaColor: colorInverted(delta.cac_pct),
        chip: chipSpecFor(vsGoal.cac_status),
        sub: 'vs periodo anterior'
      },
      {
        label: 'Preaut+',
        value: fmtNum(current.preaut_positivos),
        rawValue: current.preaut_positivos,
        deltaText: fmtDeltaAbs(delta.preaut_positivos_abs),
        deltaSrc:  delta.preaut_positivos_abs,
        deltaColor: colorDirect(delta.preaut_positivos_abs),
        sub: 'vs periodo anterior'
      }
    ];

    var grid = document.getElementById('daily-sticky-grid');
    if (!grid) return;
    grid.innerHTML = cells.map(kpiHtml).join('');
  }

  function chipSpecFor(status) {
    if (status === 'red')   return { className: 'red',   label: 'Rojo' };
    if (status === 'amber') return { className: 'amber', label: 'Amarillo' };
    if (status === 'green') return { className: 'green', label: 'Verde' };
    return { className: 'neutral', label: 'Sin meta' };
  }

  function kpiHtml(cell) {
    var titleAttr = (cell.rawValue != null && !isNaN(cell.rawValue))
      ? ' title="' + escapeHtml(String(cell.rawValue)) + '"'
      : '';
    var chip = cell.chip
      ? '<span class="daily-kpi__chip daily-kpi__chip--' + cell.chip.className + '">' + escapeHtml(cell.chip.label) + '</span>'
      : '';
    var deltaHtml = '';
    if (cell.deltaText) {
      var arrow = arrowFor(cell.deltaSrc);
      // flat arrow + ± text would double-signal "zero"; show just the text.
      var prefix = (cell.deltaSrc === 0) ? '' : (arrow + ' ');
      deltaHtml = '<span class="daily-kpi__delta daily-kpi__delta--' + cell.deltaColor + '">'
                + prefix + escapeHtml(cell.deltaText) + '</span>';
    } else if (cell.deltaSrc === undefined || cell.deltaSrc === null || cell.value === '—') {
      deltaHtml = '<span class="daily-kpi__delta daily-kpi__delta--flat">—</span>';
    }
    return ''
      + '<div class="daily-kpi">'
      +   '<div class="daily-kpi__head">'
      +     '<div class="daily-kpi__label">' + escapeHtml(cell.label) + '</div>'
      +     chip
      +   '</div>'
      +   '<div class="daily-kpi__value num"' + titleAttr + '>' + escapeHtml(cell.value) + '</div>'
      +   '<div class="daily-kpi__sub">' + deltaHtml + (cell.sub ? '<span>' + escapeHtml(cell.sub) + '</span>' : '') + '</div>'
      + '</div>';
  }

  // ── Data freshness indicator ─────────────────────────────────────────
  // Surfaces pipeline lag. ≥60min paints amber so Mario sees when data is
  // stale (pipeline failed silently, Meta Ads sync broke, etc.).
  function updateFreshness(data) {
    var slot = document.getElementById('daily-freshness');
    if (!slot) return;
    var iso = data && data.meta && data.meta.generated_at;
    if (!iso) { slot.textContent = ''; slot.classList.remove('daily-freshness--stale'); return; }
    var genMs = Date.parse(iso);
    if (isNaN(genMs)) { slot.textContent = ''; slot.classList.remove('daily-freshness--stale'); return; }
    var diffSec = Math.max(0, Math.round((Date.now() - genMs) / 1000));
    var text, stale = false;
    if (diffSec < 60) {
      text = 'Actualizado hace unos segundos';
    } else if (diffSec < 3600) {
      text = 'Actualizado hace ' + Math.floor(diffSec / 60) + 'm';
    } else {
      var hours = Math.floor(diffSec / 3600);
      text = 'Actualizado hace ' + hours + 'h (revisar pipeline)';
      stale = true;
    }
    slot.textContent = text;
    slot.classList.toggle('daily-freshness--stale', stale);
  }

  // ── Render: subtitle (period label from meta) ────────────────────────
  function updateSubtitle(data) {
    var slot = document.getElementById('daily-subtitle');
    if (!slot) return;
    if (!data || !data.meta || !data.meta.period) {
      slot.textContent = 'Cargando…';
      return;
    }
    var p = data.meta.period;
    var from = p.from || '';
    var to   = p.to   || '';
    var days = p.days ? (p.days + (p.days === 1 ? ' día' : ' días')) : '';
    var label = labelForPeriod(state.period);
    var range = from && to ? (from + ' → ' + to) : '';
    slot.textContent = [label, range, days].filter(Boolean).join(' · ');
  }

  function labelForPeriod(period) {
    for (var i = 0; i < PERIOD_OPTIONS.length; i++) {
      if (PERIOD_OPTIONS[i].value === period) return PERIOD_OPTIONS[i].label;
    }
    return period;
  }

  // ── Banners ──────────────────────────────────────────────────────────
  function clearBanners() {
    var slot = document.getElementById('daily-banners');
    if (slot) slot.innerHTML = '';
  }

  function showRetryBanner(attempt, total) {
    var slot = document.getElementById('daily-banners');
    if (!slot) return;
    slot.innerHTML = '';
    window.Banner.create(slot, {
      variant: 'warning',
      title: 'Actualizando datos',
      message: 'El pipeline está refrescando. Reintentando (' + attempt + '/' + total + ')…'
    });
  }

  function showDataNotReadyBanner() {
    var slot = document.getElementById('daily-banners');
    if (!slot) return;
    slot.innerHTML = '';
    window.Banner.create(slot, {
      variant: 'warning',
      title: 'Datos no disponibles',
      message: 'El pipeline aún no ha procesado este periodo. Intenta de nuevo en unos minutos.',
      action: { label: 'Reintentar', onClick: function () { fetchAndRender(state.period); } }
    });
  }

  function showGenericErrorBanner() {
    var slot = document.getElementById('daily-banners');
    if (!slot) return;
    slot.innerHTML = '';
    window.Banner.create(slot, {
      variant: 'danger',
      title: 'No se pudo cargar el dashboard',
      message: 'Hubo un error al obtener los datos. Recarga la página para intentar de nuevo.',
      action: { label: 'Reintentar', onClick: function () { fetchAndRender(state.period); } }
    });
  }

  // ── Dropdown wiring ──────────────────────────────────────────────────
  function wireDropdown() {
    var sel = document.getElementById('daily-period-select');
    if (!sel) return;
    sel.addEventListener('change', function (e) {
      var next = e.target.value;
      if (!VALID_PERIODS[next]) return;
      state.period = next;
      writePeriodToUrl(next);
      fetchAndRender(next);
    });
  }

  function setDropdownEnabled(enabled) {
    var sel = document.getElementById('daily-period-select');
    if (sel) sel.disabled = !enabled;
  }

  function setDropdownValue(period) {
    var sel = document.getElementById('daily-period-select');
    if (sel && sel.value !== period) sel.value = period;
  }

  function setRefreshing(on) {
    var wrap = document.querySelector('.daily-sticky-wrapper');
    var bar  = document.querySelector('.daily-sticky');
    if (!wrap || !bar) return;
    var existing = wrap.querySelector('.daily-spinner');
    if (on) {
      bar.classList.add('daily-sticky--refreshing');
      if (!existing) {
        var sp = document.createElement('div');
        sp.className = 'daily-spinner';
        sp.setAttribute('aria-label', 'Cargando');
        wrap.appendChild(sp);
      }
    } else {
      bar.classList.remove('daily-sticky--refreshing');
      if (existing) existing.remove();
    }
  }

  // ── Main flow ────────────────────────────────────────────────────────
  function fetchAndRender(period) {
    var hasOldData = state.hasRenderedOnce;
    if (hasOldData) setRefreshing(true);
    clearBanners();

    fetchDaily(period)
      .then(function (data) {
        state.data = data;
        state.hasRenderedOnce = true;
        renderStickyBar(data);
        updateSubtitle(data);
        updateFreshness(data);
        clearBanners();
        setRefreshing(false);
        setDropdownEnabled(true);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return; // by design — silent
        setRefreshing(false);
        setDropdownEnabled(true);
        if (err && err.status === 503) {
          console.error('[daily] 503 data_not_ready after retries', err.body || '');
          showDataNotReadyBanner();
        } else {
          console.error('[daily] fetch failed', err && err.status, err && err.body, err);
          showGenericErrorBanner();
        }
      });
  }

  function mount(root) {
    state.root = root;
    state.period = readPeriodFromUrl();
    renderSkeleton();
    setDropdownValue(state.period);
    fetchAndRender(state.period);
  }

  window.EnPagosDaily = { mount: mount };
})();
