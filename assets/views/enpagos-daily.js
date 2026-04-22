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
      '<div class="daily-cards" id="daily-cards-root" aria-label="Desglose por plaza"></div>',
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

    var deltaSub = deltaSubLabelFor(state.period, data);

    var cells = [
      {
        label: 'Inversión',
        value: fmtMoneyK(current.inversion_total_meta_ads),
        rawValue: current.inversion_total_meta_ads,
        deltaText: fmtDeltaPct(delta.inversion_pct),
        deltaSrc:  delta.inversion_pct,
        deltaColor: colorDirect(delta.inversion_pct),
        deltaSub:  deltaSub
      },
      {
        label: 'Cierres',
        value: fmtNum(current.cierres),
        rawValue: current.cierres,
        deltaText: fmtDeltaAbs(delta.cierres_abs),
        deltaSrc:  delta.cierres_abs,
        deltaColor: colorDirect(delta.cierres_abs),
        deltaSub:  deltaSub,
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
        deltaSub:  cacValue == null ? null : deltaSub
      },
      {
        label: 'Preaut+',
        value: fmtNum(current.preaut_positivos),
        rawValue: current.preaut_positivos,
        deltaText: fmtDeltaAbs(delta.preaut_positivos_abs),
        deltaSrc:  delta.preaut_positivos_abs,
        deltaColor: colorDirect(delta.preaut_positivos_abs),
        deltaSub:  deltaSub
      }
    ];

    var grid = document.getElementById('daily-sticky-grid');
    if (!grid) return;
    grid.innerHTML = cells.map(kpiHtml).join('');
  }

  // UX FIX 1 (Gate 0, feedback Mario/Anwar): chips show what they MEAN for Mario
  // rather than a color name. null → no chip (don't render "Sin meta" either —
  // signal absence of a threshold by absence of a chip).
  function chipSpecFor(status) {
    if (status === 'red')   return { className: 'red',   label: 'Por debajo de meta' };
    if (status === 'amber') return { className: 'amber', label: 'Cerca de meta' };
    if (status === 'green') return { className: 'green', label: 'En meta' };
    return null;
  }

  // UX FIX 2 (Gate 0): delta sub-label tells Mario WHAT the comparison is.
  // "+182% vs periodo anterior" is ambiguous when periods vary; spell it out.
  // For mtd, pull the actual range from meta.previous_period so the label
  // updates daily as the current month progresses.
  var MONTH_NAMES_UPPER = [
    'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
    'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
  ];
  function deltaSubLabelFor(period, data) {
    if (period === 'today')     return 'vs ayer';
    if (period === 'yesterday') return 'vs anteayer';
    if (period === '7d')        return 'vs 7d anteriores';
    if (period === '30d')       return 'vs 30d anteriores';
    if (period === 'mtd') {
      var prev = data && data.meta && data.meta.previous_period;
      if (!prev || !prev.from || !prev.to) return 'vs mes anterior';
      var fromParts = String(prev.from).split('-');
      var toParts   = String(prev.to).split('-');
      var monthNum  = parseInt(fromParts[1], 10);
      var toDay     = parseInt(toParts[2], 10);
      var monthName = MONTH_NAMES_UPPER[monthNum - 1];
      if (!monthName || isNaN(toDay)) return 'vs mes anterior';
      return 'vs ' + monthName + ' (1-' + toDay + ')';
    }
    return 'vs periodo anterior';
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
    var deltaSubHtml = cell.deltaSub
      ? '<span class="daily-kpi__delta-sub">' + escapeHtml(cell.deltaSub) + '</span>'
      : '';
    var goalHintHtml = cell.sub
      ? '<span class="daily-kpi__goal-hint">' + escapeHtml(cell.sub) + '</span>'
      : '';
    return ''
      + '<div class="daily-kpi">'
      +   '<div class="daily-kpi__head">'
      +     '<div class="daily-kpi__label">' + escapeHtml(cell.label) + '</div>'
      +     chip
      +   '</div>'
      +   '<div class="daily-kpi__value num"' + titleAttr + '>' + escapeHtml(cell.value) + '</div>'
      +   '<div class="daily-kpi__sub">' + deltaHtml + deltaSubHtml + goalHintHtml + '</div>'
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

  // ── Render: per-plaza cards grid (Gate 3) ────────────────────────────
  //
  // Variant A (cierres>0): label "CAC" + value + chip from vs_goal.cac_status
  //   + delta (direct color from delta.cierres_abs) + sparkline + footer
  //   "Objetivo CAC: $N".
  // Variant B (cierres=0, preaut+>0): label "Costo/preaut+" + value. Delta
  //   omitted per Gate 3 spec — by_city.delta shape is typically
  //   {cierres_abs} only; no preaut_positivos_abs available at per-city.
  // Variant C (cierres=0, preaut+=0): plaza name header + "Sin actividad"
  //   empty-state body + dashed border.
  //
  // KPICard NOT reused here: its tier=red override forces delta=neutral,
  // which would subvert Gate 3 spec's "color DIRECTO" for cierres delta
  // in Variante A. Custom cards mirror the sticky-bar pattern instead.
  function renderCards(data) {
    var mount = document.getElementById('daily-cards-root');
    if (!mount) return;

    var byCity = data && data.by_city;
    if (!byCity || typeof byCity !== 'object' || Object.keys(byCity).length === 0) {
      mount.innerHTML = '';
      var banners = document.getElementById('daily-banners');
      if (banners) {
        window.Banner.create(banners, {
          variant: 'danger',
          title: 'No hay data de plazas',
          message: 'El pipeline no envió desglose por plaza. Revisa el pipeline optix-loops.'
        });
      }
      return;
    }

    var plazas = Object.keys(byCity).sort();
    var deltaSub = deltaSubLabelFor(state.period, data);
    mount.innerHTML = plazas.map(function (plaza) {
      return cardHtml(plaza, byCity[plaza] || {}, deltaSub);
    }).join('');
  }

  // 5-way variant dispatch. Order matters — each case is mutually exclusive
  // and the first match wins. The escalation tells a story top-to-bottom:
  //   A → "this plaza is producing cierres"
  //   B → "plaza has preaut+ but hasn't closed yet"
  //   D → "plaza has raw leads but none qualified through bureau"  (NEW)
  //   E → "plaza burning spend with zero leads — revisar"          (NEW)
  //   C → "plaza dormant: nothing at all happening"
  // D and E need the pipeline's new current.leads_brutos field. If that field
  // is absent (old response shape pre-Gate-0.5), leads_brutos defaults to 0
  // and the card safely falls through to C/E without crashing — so deploy
  // order (pipeline-first) is a preference, not a hard block.
  function cardHtml(plaza, city, deltaSub) {
    var current = city.current || {};
    var delta   = city.delta   || {};
    var vsGoal  = city.vs_goal || {};
    var cierres      = current.cierres || 0;
    var preaut       = current.preaut_positivos || 0;
    var leadsBrutos  = current.leads_brutos || 0;
    var spend        = current.inversion_atribuida || 0;

    if (cierres > 0) {
      return cardVariantA(plaza, current, delta, vsGoal, city.sparkline_cierres, deltaSub);
    }
    if (preaut > 0) {
      return cardVariantB(plaza, current, city.sparkline_cierres);
    }
    if (leadsBrutos > 0) {
      return cardVariantD(plaza, current, city.sparkline_cierres);
    }
    if (spend > 0) {
      return cardVariantE(plaza, current, city.sparkline_inversion);
    }
    return cardVariantC(plaza);
  }

  // Shared: "Inversión $X,XXX" line shown on A/B/D when the plaza received
  // attributed spend in the period. Variante E already surfaces spend as its
  // main metric (would duplicate); Variante C / SIN-ATRIBUCION / ORGANICOS
  // hit the inv<=0 guard and render nothing — no special-case needed.
  function investedLineHtml(current) {
    var inv = current && current.inversion_atribuida;
    if (inv == null || isNaN(inv) || inv <= 0) return '';
    return '<div class="daily-card__invested">Inversión '
         + escapeHtml(fmtMoney(inv)) + '</div>';
  }

  function cardVariantA(plaza, current, delta, vsGoal, sparkData, deltaSub) {
    // UX FIX 1: chip label semantic, null status → no chip at all.
    var chip = chipSpecFor(vsGoal.cac_status);
    var cacGoal = vsGoal.cac_objetivo;
    var cacHint = cacGoal != null
      ? 'Objetivo CAC: ' + fmtMoney(cacGoal)
      : 'Objetivo CAC: no definido';

    // UX FIX 3: append absolute cierres count to CAC value ("$2,206 · 1 cierre")
    // so Mario sees the denominator when CAC looks too good / too bad.
    var cierresAbsCount = current.cierres;
    var cierresLabel = '';
    if (cierresAbsCount != null && cierresAbsCount > 0) {
      cierresLabel = ' <span class="daily-card__metric-sub">· '
                   + cierresAbsCount + ' cierre'
                   + (cierresAbsCount === 1 ? '' : 's')
                   + '</span>';
    }

    // UX FIX 2: delta sub-label per card (same period ctx as the sticky bar).
    var cierresDelta = delta.cierres_abs;
    var deltaHtml = '';
    if (cierresDelta == null || isNaN(cierresDelta)) {
      deltaHtml = '<span class="daily-card__delta daily-card__delta--flat">—</span>';
    } else {
      var cls = colorDirect(cierresDelta);
      var prefix = (cierresDelta === 0) ? '' : (arrowFor(cierresDelta) + ' ');
      var label = cierresDelta === 0
        ? '±0 cierres'
        : (prefix + escapeHtml(fmtDeltaAbs(cierresDelta)) + ' cierre' + (Math.abs(cierresDelta) === 1 ? '' : 's'));
      deltaHtml = '<span class="daily-card__delta daily-card__delta--' + cls + '">' + label + '</span>';
    }
    var deltaSubHtml = deltaSub
      ? '<span class="daily-card__delta-sub">' + escapeHtml(deltaSub) + '</span>'
      : '';
    var chipHtml = chip
      ? '<span class="daily-kpi__chip daily-kpi__chip--' + chip.className + '">' + escapeHtml(chip.label) + '</span>'
      : '';

    return ''
      + '<div class="daily-card" data-variant="A" data-plaza="' + escapeHtml(plaza) + '">'
      +   '<div class="daily-card__header">'
      +     '<h3 class="daily-card__plaza">' + escapeHtml(plaza) + '</h3>'
      +     chipHtml
      +   '</div>'
      +   '<div class="daily-card__body">'
      +     '<div class="daily-card__metric-label">CAC</div>'
      +     '<div class="daily-card__metric-value">' + escapeHtml(fmtMoney(current.cac)) + cierresLabel + '</div>'
      +     '<div class="daily-card__delta-row">' + deltaHtml + deltaSubHtml + '</div>'
      +     investedLineHtml(current)
      +     sparklineHtml(sparkData)
      +   '</div>'
      +   '<div class="daily-card__foot">' + escapeHtml(cacHint) + '</div>'
      + '</div>';
  }

  function cardVariantB(plaza, current, sparkData) {
    return ''
      + '<div class="daily-card" data-variant="B" data-plaza="' + escapeHtml(plaza) + '">'
      +   '<div class="daily-card__header">'
      +     '<h3 class="daily-card__plaza">' + escapeHtml(plaza) + '</h3>'
      +   '</div>'
      +   '<div class="daily-card__body">'
      +     '<div class="daily-card__metric-label">Costo / preaut+</div>'
      +     '<div class="daily-card__metric-value">' + escapeHtml(fmtMoney(current.costo_preaut_positivo)) + '</div>'
      +     '<div class="daily-card__delta daily-card__delta--flat">Sin cierres todavía</div>'
      +     investedLineHtml(current)
      +     sparklineHtml(sparkData)
      +   '</div>'
      +   '<div class="daily-card__foot">Preaut+ sin cierre — data de referencia</div>'
      + '</div>';
  }

  // Variante D — LEADS_SIN_PREAUT: leads entraron pero ninguno llegó a
  // preaut+ todavía. Métrica principal "N leads · 0 preaut+" informa a Mario
  // que el tráfico SÍ existe pero el filtro bureau está cortando. Sin chip
  // (no hay CAC aún para marcar status). Card gris un tono más claro que
  // variante C (sentido: no está muerta, solo sin conversión aún).
  function cardVariantD(plaza, current, sparkData) {
    var n = current.leads_brutos || 0;
    return ''
      + '<div class="daily-card daily-card--leads-only" data-variant="D" data-plaza="' + escapeHtml(plaza) + '">'
      +   '<div class="daily-card__header">'
      +     '<h3 class="daily-card__plaza">' + escapeHtml(plaza) + '</h3>'
      +   '</div>'
      +   '<div class="daily-card__body">'
      +     '<div class="daily-card__metric-label">Leads sin preaut+</div>'
      +     '<div class="daily-card__metric-value">' + n + ' lead' + (n === 1 ? '' : 's')
      +       ' <span class="daily-card__metric-sub">· 0 preaut+</span></div>'
      +     '<div class="daily-card__delta daily-card__delta--flat">Lead sin calificar</div>'
      +     investedLineHtml(current)
      +     sparklineHtml(sparkData)
      +   '</div>'
      +   '<div class="daily-card__foot">Revisar calidad del tráfico</div>'
      + '</div>';
  }

  // Variante E — SPEND_SIN_LEADS: hay gasto en ads pero cero leads. Chip
  // "Revisar" ámbar informativo (NO rojo alarma — el cliente lo va a ver
  // y el mensaje es "revisar" no "falla crítica"). Borde ámbar sutil.
  // Sparkline de inversión (si hay data) muestra si el gasto es sostenido
  // o reciente.
  function cardVariantE(plaza, current, sparkInversion) {
    var spend = current.inversion_atribuida || 0;
    return ''
      + '<div class="daily-card daily-card--spend-only" data-variant="E" data-plaza="' + escapeHtml(plaza) + '">'
      +   '<div class="daily-card__header">'
      +     '<h3 class="daily-card__plaza">' + escapeHtml(plaza) + '</h3>'
      +     '<span class="daily-kpi__chip daily-kpi__chip--amber">Revisar</span>'
      +   '</div>'
      +   '<div class="daily-card__body">'
      +     '<div class="daily-card__metric-label">Spend sin leads</div>'
      +     '<div class="daily-card__metric-value">' + escapeHtml(fmtMoney(spend))
      +       ' <span class="daily-card__metric-sub">· 0 leads</span></div>'
      +     '<div class="daily-card__delta daily-card__delta--flat">Gasto sin atribución</div>'
      +     sparklineHtml(sparkInversion)
      +   '</div>'
      +   '<div class="daily-card__foot">Revisar mapping ads → plaza</div>'
      + '</div>';
  }

  function cardVariantC(plaza) {
    return ''
      + '<div class="daily-card daily-card--empty" data-variant="C" data-plaza="' + escapeHtml(plaza) + '">'
      +   '<div class="daily-card__header">'
      +     '<h3 class="daily-card__plaza">' + escapeHtml(plaza) + '</h3>'
      +   '</div>'
      +   '<div class="daily-card__empty-body">'
      +     '<svg class="daily-card__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      +       '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'
      +     '</svg>'
      +     '<div class="daily-card__empty-text">Sin actividad</div>'
      +   '</div>'
      + '</div>';
  }

  function sparklineHtml(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return '<div class="daily-card__spark" aria-hidden="true"></div>';
    }
    var allZero = points.every(function (n) { return n === 0 || n == null; });
    if (allZero) {
      return '<div class="daily-card__spark" aria-hidden="true"></div>';
    }
    var svg = window.Sparkline && window.Sparkline.html
      ? window.Sparkline.html({ points: points, width: 200, height: 28, showDot: true })
      : '';
    return '<div class="daily-card__spark" aria-hidden="true">' + svg + '</div>';
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
        // Clear any retry/loading banners before rendering, so any
        // defensive banner added by renderCards (e.g., missing by_city)
        // survives instead of being wiped post-render.
        clearBanners();
        renderStickyBar(data);
        renderCards(data);
        updateSubtitle(data);
        updateFreshness(data);
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
