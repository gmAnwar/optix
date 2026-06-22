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
    'kpi-strip-section',
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

        // Render sections in INDIVIDUAL try/catches. Rationale: any throw from
        // a single renderer (e.g. unexpected payload shape) used to bubble to
        // the outer .catch() — which is wired to the network-error banner
        // "No se pudo cargar el periodo". That conflates two failure modes:
        //   1. Real fetch failure (network / HTTP 4xx/5xx) → banner correct
        //   2. Render-time bug (data IS loaded, JS threw) → banner misleads
        //      ("no se pudo cargar" implies fetch failed when it didn't)
        // Now: render errors are logged to console with full stack and that
        // section is skipped; other sections still render. Real fetch errors
        // still hit the outer .catch as before.
        var sections = [
          ['renderGoals',           function () { renderGoals(data, period); }],
          ['renderKpiStrip',        function () { renderKpiStrip(data, period); }],
          ['renderPreautFamilia',   function () { renderPreautFamilia(data); }],
          ['renderPlazaCards',      function () { renderPlazaCards(data); }],
          ['renderTodayDetailFeed', function () { renderTodayDetailFeed(data); }]
        ];
        for (var i = 0; i < sections.length; i++) {
          try {
            sections[i][1]();
          } catch (renderErr) {
            console.error(
              '[enpagos-home] render error in ' + sections[i][0] +
              ' for period=' + period + ':',
              renderErr
            );
          }
        }
        clearBanner();
        setSelectorLoading(false);
      })
      .catch(function (err) {
        // This branch only fires for FETCH failures (network error, HTTP
        // non-2xx, JSON parse failure). Render-time exceptions are caught
        // above and never reach here.
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

  // ── S84 Home superior — Fila 1 (Cierres + Inversión) ──────────────────
  //
  // Reemplaza la triplicación previa (F3.2 goals chips + F3.3 hero cards +
  // F3.4 kpi-strip) por 3 filas donde cada número aparece UNA vez:
  //
  //   Fila 1 (renderGoals)    — 3 cajas grandes: Cierres + Inversión + Preaut+
  //                             vs meta del mes, con barra prorrateada +
  //                             chip de estado.
  //   Fila 2 (renderKpiStrip) — Preaut+ hoy · Daily avg · Proy. Cierres EOM
  //                             · Proy. Inversión EOM (proj/avg solo mtd).
  //   Fila 3 (renderKpiStrip) — CAC Preaut+ · CAC Cierres con chip vs obj.
  //
  // Tier chip de Cierres compara contra los prorrateados
  //   (cierres_tier_rojo_max_periodo / cierres_tier_amarillo_max_periodo)
  // — escala coherente con la barra, ambas prorrateadas a días transcurridos.
  // Inversión chip compara contra inversion_planeada_periodo (prorrateado).
  //
  // Barra SOLO en period=mtd. En otros periods cada caja degrada a un
  // valor grande + delta vs periodo previo, sin barra.

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

  function _fmtFloat1(n) {
    // 1 decimal place — para "esperados" prorrateados de Preaut+ del mes
    // (91 × dias/30 raras veces es entero, 12.1 cuadra al display).
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(1);
  }

  // ── Fila 1 helpers ────────────────────────────────────────────────────

  // Tier de Cierres en escala prorrateada (NOT escala mensual): si el valor
  // a la fecha cae por debajo del rojo_max prorrateado → rojo; entre rojo
  // y amarillo → amarillo; sobre amarillo → verde. Si los thresholds están
  // ausentes (legacy nivel=semanal nulled o doc sin tiers) → '', neutral.
  function _cierresTierStatus(actual, rojoMaxP, amarilloMaxP) {
    if (actual == null || isNaN(actual)) return '';
    if (rojoMaxP == null || isNaN(rojoMaxP)) return '';
    if (amarilloMaxP == null || isNaN(amarilloMaxP)) return '';
    var a = Number(actual);
    if (a < Number(rojoMaxP))      return 'red';
    if (a < Number(amarilloMaxP))  return 'yellow';
    return 'green';
  }

  // Status de Inversión vs plan prorrateado. Sobregasto > +5% del esperado
  // → rojo (alarma presupuesto); subgasto < -20% → amarillo (falta gastar);
  // en banda → verde.
  function _inversionPlanStatus(actual, expected) {
    if (actual == null || isNaN(actual)) return '';
    if (expected == null || isNaN(expected) || expected <= 0) return '';
    var ratio = Number(actual) / Number(expected);
    if (ratio > 1.05) return 'red';
    if (ratio < 0.80) return 'yellow';
    return 'green';
  }

  // Status simple de Preaut+ del mes vs lineal esperado. 2-estados (sin
  // tier-bands) para mantener simetría visual con Cierres/Inversión sin
  // arrastrar los tiers cantidad de Preaut+ (esos viven en Fila 2 si
  // alguna vez se piden). actual >= expected → verde, < → rojo.
  function _preautMesStatus(actual, expected) {
    if (actual == null || isNaN(actual)) return '';
    if (expected == null || isNaN(expected) || expected <= 0) return '';
    return (Number(actual) >= Number(expected)) ? 'green' : 'red';
  }

  function _tierChipLabel(status, kind) {
    // kind: 'cierres' | 'inversion' | 'preaut'.
    if (kind === 'cierres') {
      if (status === 'green')  return 'EXCELENTE';
      if (status === 'yellow') return 'BUENO';
      if (status === 'red')    return 'BAJO META';
      return '';
    }
    if (kind === 'preaut') {
      // 2-estados, mismo eje que Cierres: al ritmo o atrasado.
      if (status === 'green')  return 'AL RITMO';
      if (status === 'red')    return 'BAJO META';
      return '';
    }
    // inversion
    if (status === 'green')  return 'EN PLAN';
    if (status === 'yellow') return 'BAJO PLAN';
    if (status === 'red')    return 'SOBREPLAN';
    return '';
  }

  function _row1ProgressBarHTML(opts) {
    // opts: { fillPct (0..1+), expectedPct (0..1+), status, graceful }
    // expectedPct: posición de la marca "esperado" (prorrateado / tope).
    // fillPct puede exceder 1.0 (overspend); se clampa a 100 visualmente
    // pero el chip de status ya refleja la condición de exceso.
    var fill = opts.fillPct == null || isNaN(opts.fillPct) ? 0 : Number(opts.fillPct);
    var fillPx = Math.max(0, Math.min(100, fill * 100));
    var exp = opts.expectedPct == null || isNaN(opts.expectedPct) ? null : Number(opts.expectedPct);
    var expPx = exp == null ? null : Math.max(0, Math.min(100, exp * 100));
    var cls = 'row1-bar';
    if (opts.graceful) cls += ' row1-bar--graceful';
    var fillCls = 'row1-bar__fill';
    if (opts.status) fillCls += ' row1-bar__fill--' + opts.status;
    var marker = (expPx != null)
      ? '<div class="row1-bar__marker" style="left:' + expPx.toFixed(1) + '%"' +
        ' title="Esperado a la fecha"></div>'
      : '';
    return (
      '<div class="' + cls + '" role="progressbar"' +
        ' aria-valuenow="' + fillPx.toFixed(1) + '"' +
        ' aria-valuemin="0" aria-valuemax="100">' +
        '<div class="' + fillCls + '" style="width:' + fillPx.toFixed(1) + '%"></div>' +
        marker +
      '</div>'
    );
  }

  function _row1ChipHTML(status, label) {
    if (!status || !label) return '';
    return '<span class="row1-chip row1-chip--' + status + '">' + escapeHtml(label) + '</span>';
  }

  function _row1BoxHTML(opts) {
    // opts: { label, bigHTML, chipHTML, barHTML, expectedHTML, topeHTML, footHTML, gracefulCls, tooltip }
    var cls = 'row1-box';
    if (opts.gracefulCls) cls += ' ' + opts.gracefulCls;
    var tooltipAttr = opts.tooltip ? ' title="' + escapeHtml(opts.tooltip) + '"' : '';
    var headRight = opts.chipHTML || '';
    var meta = '';
    if (opts.expectedHTML || opts.topeHTML) {
      meta =
        '<div class="row1-box__meta">' +
          (opts.expectedHTML
            ? '<span class="row1-box__expected">' + opts.expectedHTML + '</span>'
            : '') +
          (opts.topeHTML
            ? '<span class="row1-box__tope">' + opts.topeHTML + '</span>'
            : '') +
        '</div>';
    }
    return (
      '<div class="' + cls + '"' + tooltipAttr + '>' +
        '<div class="row1-box__head">' +
          '<span class="row1-box__label">' + escapeHtml(opts.label) + '</span>' +
          headRight +
        '</div>' +
        '<div class="row1-box__big">' + opts.bigHTML + '</div>' +
        (opts.barHTML || '') +
        meta +
        (opts.footHTML ? '<div class="row1-box__foot">' + opts.footHTML + '</div>' : '') +
      '</div>'
    );
  }

  function _row1DeltaHTML(absDelta, pctDelta, periodLabel, invertColor) {
    // Reusa _deltaLineHTML (definido más abajo en el archivo). Se llama
    // forward — function declarations son hoisted, no hay TDZ issue.
    return _deltaLineHTML(absDelta, pctDelta, periodLabel, { invertColor: !!invertColor });
  }

  function renderGoals(data, period) {
    var sec = document.getElementById('goals-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    var current   = (data.totals && data.totals.current)   || {};
    var delta     = (data.totals && data.totals.delta)     || {};
    var prorrated = data.goals_prorrated                   || {};
    var goals     = data.goals                             || {};
    var isMtd     = (period === 'mtd');
    var periodLabel = _formatPreviousLabel(period, data);

    // ── Cierres caja ──────────────────────────────────────────────────
    var cierresVal     = current.cierres;
    var cierresGoalMo  = goals.cierres_meta && goals.cierres_meta.valor;
    var cierresGoalP   = prorrated.cierres_goal_periodo;
    var cierresRojoP   = prorrated.cierres_tier_rojo_max_periodo;
    var cierresAmarP   = prorrated.cierres_tier_amarillo_max_periodo;

    var cierresHTML;
    if (isMtd) {
      var tierStatus = _cierresTierStatus(cierresVal, cierresRojoP, cierresAmarP);
      var fillPct = (cierresGoalMo != null && cierresGoalMo > 0 && cierresVal != null)
        ? (Number(cierresVal) / Number(cierresGoalMo)) : 0;
      var expPct = (cierresGoalMo != null && cierresGoalMo > 0 && cierresGoalP != null)
        ? (Number(cierresGoalP) / Number(cierresGoalMo)) : null;
      cierresHTML = _row1BoxHTML({
        label: 'Cierres del mes',
        bigHTML: _fmtInt(cierresVal),
        chipHTML: _row1ChipHTML(tierStatus, _tierChipLabel(tierStatus, 'cierres')),
        barHTML: _row1ProgressBarHTML({
          fillPct: fillPct, expectedPct: expPct, status: tierStatus
        }),
        expectedHTML: (cierresGoalP != null)
          ? _fmtInt(cierresGoalP) + ' esperados'
          : '',
        topeHTML: (cierresGoalMo != null)
          ? 'Meta ' + _fmtInt(cierresGoalMo)
          : ''
      });
    } else {
      cierresHTML = _row1BoxHTML({
        label: 'Cierres',
        bigHTML: _fmtInt(cierresVal),
        footHTML: _row1DeltaHTML(delta.cierres_abs, null, periodLabel, false)
      });
    }

    // ── Inversión caja ────────────────────────────────────────────────
    var invVal    = current.inversion_total_meta_ads;
    var invGoalMo = (goals.inversion_meta && goals.inversion_meta.valor) ||
                    (goals.inversion_planeada && goals.inversion_planeada.valor);
    var invGoalP  = prorrated.inversion_planeada_periodo;
    var invDown   = (invVal == null || invVal === 0);

    var invHTML;
    if (isMtd) {
      var invStatus = invDown ? '' : _inversionPlanStatus(invVal, invGoalP);
      var invFillPct = (invGoalMo != null && invGoalMo > 0 && invVal != null)
        ? (Number(invVal) / Number(invGoalMo)) : 0;
      var invExpPct = (invGoalMo != null && invGoalMo > 0 && invGoalP != null)
        ? (Number(invGoalP) / Number(invGoalMo)) : null;
      invHTML = _row1BoxHTML({
        label: 'Inversión del mes',
        bigHTML: invDown ? '—' : _fmtCurrency(invVal),
        chipHTML: _row1ChipHTML(invStatus, _tierChipLabel(invStatus, 'inversion')),
        barHTML: _row1ProgressBarHTML({
          fillPct: invFillPct, expectedPct: invExpPct,
          status: invStatus, graceful: invDown
        }),
        expectedHTML: (invGoalP != null)
          ? _fmtCurrency(invGoalP) + ' esperado'
          : '',
        topeHTML: (invGoalMo != null)
          ? 'Plan ' + _fmtCurrency(invGoalMo)
          : '',
        gracefulCls: invDown ? 'row1-box--graceful' : '',
        tooltip: invDown ? 'Pipeline de inversión actualizando' : ''
      });
    } else {
      invHTML = _row1BoxHTML({
        label: 'Inversión',
        bigHTML: invDown ? '—' : _fmtCurrency(invVal),
        footHTML: _row1DeltaHTML(null, delta.inversion_pct, periodLabel, false),
        gracefulCls: invDown ? 'row1-box--graceful' : '',
        tooltip: invDown ? 'Pipeline de inversión actualizando' : ''
      });
    }

    // ── Preaut+ del mes caja (acumulado MTD vs meta mensual cruda) ────
    // Mirror visual de Cierres del mes: misma helper _row1BoxHTML, misma
    // barra _row1ProgressBarHTML, mismo chip _row1ChipHTML. Diferencias:
    //   - Status SIMPLE 2-estados (al ritmo / bajo meta) en vez del
    //     tier-band de Cierres. Anwar S84 3a: mantener simetría visual
    //     con Inversión sin arrastrar los tier-bands de cantidad de
    //     Preaut+ (esos viven en Fila 2 si se necesitan).
    //   - "esperados" prorrateado con 1 decimal (91 × dias/30 raras veces
    //     es entero, "12.1 esperados" cuadra al display).
    // No es lo mismo que la caja "Preaut+ hoy" de Fila 2 (renderKpiStrip):
    // esa es pulso diario con badge de ritmo, ésta es acumulado-del-mes
    // con barra de progreso.
    var preautVal    = current.preaut_positivos;
    var preautGoalMo = (goals.preaut_positivos_goal &&
                        goals.preaut_positivos_goal.valor) ||
                       (goals.preaut_positivos_meta &&
                        goals.preaut_positivos_meta.valor);
    var preautGoalP  = prorrated.preaut_positivos_goal_periodo;

    var preautHTML;
    if (isMtd) {
      var preautStatus = _preautMesStatus(preautVal, preautGoalP);
      var preautFillPct = (preautGoalMo != null && preautGoalMo > 0 && preautVal != null)
        ? (Number(preautVal) / Number(preautGoalMo)) : 0;
      var preautExpPct = (preautGoalMo != null && preautGoalMo > 0 && preautGoalP != null)
        ? (Number(preautGoalP) / Number(preautGoalMo)) : null;
      preautHTML = _row1BoxHTML({
        label: 'Preaut+ del mes',
        bigHTML: _fmtInt(preautVal),
        chipHTML: _row1ChipHTML(preautStatus, _tierChipLabel(preautStatus, 'preaut')),
        barHTML: _row1ProgressBarHTML({
          fillPct: preautFillPct, expectedPct: preautExpPct, status: preautStatus
        }),
        expectedHTML: (preautGoalP != null)
          ? _fmtFloat1(preautGoalP) + ' esperados'
          : '',
        topeHTML: (preautGoalMo != null)
          ? 'Meta ' + _fmtInt(preautGoalMo)
          : ''
      });
    } else {
      preautHTML = _row1BoxHTML({
        label: 'Preaut+',
        bigHTML: _fmtInt(preautVal),
        footHTML: _row1DeltaHTML(delta.preaut_positivos_abs, null, periodLabel, false)
      });
    }

    // ── Venta del mes caja (S89 — monto + barra vs meta, SIN chip ni marker) ───
    // Decisión Anwar Opción B: la caja muestra solo el avance vs meta total,
    // sin lectura "AL RITMO/BAJO META" (que con el prorrateo lineal sería
    // engañosa en mes en curso). Sin marker prorrateado tampoco — la única
    // referencia es el tope absoluto. _row1BoxHTML omite chip/marker/expected
    // limpiamente cuando se pasan vacíos (verificado por inspección, lines
    // 312-340: headRight = chipHTML||'', meta block solo emite si expected
    // o tope no vacíos, _row1ProgressBarHTML deja marker fuera si
    // expectedPct=null y barra gris si status='').
    var ventaVal    = current.venta;
    var ventaGoalMo = (goals.venta_meta && goals.venta_meta.valor) ||
                      (goals.venta_goal && goals.venta_goal.valor);

    var ventaHTML;
    if (isMtd) {
      var ventaFillPct = (ventaGoalMo != null && ventaGoalMo > 0 && ventaVal != null)
        ? (Number(ventaVal) / Number(ventaGoalMo)) : 0;

      // S89-firmas-proy — Sub-línea de proyección: "+ $X en N firmas
      // programadas → $TOTAL proyectada". El big number arriba sigue siendo
      // venta cerrada solamente; la sub-línea agrega contexto del pipeline
      // sin contaminar el dato cerrado. Omitir entero (no mostrar "+$0" o
      // "en 0 firmas") cuando venta_firmas o firmas son 0 o ausentes.
      // El slot footHTML es nativo de _row1BoxHTML — renderea
      // <div class="row1-box__foot"> con tipografía 12px gris #8a8a8a.
      var ventaFirmasVal = current.venta_firmas_programadas;
      var firmasCount    = current.firmas_programadas;
      var ventaFootHTML  = '';
      if (ventaFirmasVal != null && Number(ventaFirmasVal) > 0 &&
          firmasCount != null && Number(firmasCount) > 0 &&
          ventaVal != null) {
        var proyectada = Number(ventaVal) + Number(ventaFirmasVal);
        ventaFootHTML = '+ ' + _fmtCurrency(ventaFirmasVal) +
          ' en ' + _fmtInt(firmasCount) +
          ' firma' + (firmasCount === 1 ? '' : 's') + ' programada' +
          (firmasCount === 1 ? '' : 's') +
          ' → ' + _fmtCurrency(proyectada) + ' proyectada';
      }

      ventaHTML = _row1BoxHTML({
        label: 'Venta del mes',
        bigHTML: _fmtCurrency(ventaVal),
        chipHTML: '',                          // omit: sin chip
        barHTML: _row1ProgressBarHTML({
          fillPct: ventaFillPct,
          expectedPct: null,                   // omit: sin marker
          status: ''                           // sin status → barra gris default
        }),
        expectedHTML: '',                      // omit: sin "esperado"
        topeHTML: (ventaGoalMo != null)
          ? 'Plan ' + _fmtCurrency(ventaGoalMo)
          : '',
        footHTML: ventaFootHTML                // S89-firmas-proy
      });
    } else {
      ventaHTML = _row1BoxHTML({
        label: 'Venta',
        bigHTML: _fmtCurrency(ventaVal),
        footHTML: _row1DeltaHTML(null, delta.venta_pct, periodLabel, false)
      });
    }

    sec.innerHTML =
      '<div class="row1-grid" role="group" aria-label="Cierres, inversión, Preaut+ y venta vs meta">' +
        cierresHTML + invHTML + preautHTML + ventaHTML +
      '</div>';
  }

  window.__renderGoals = renderGoals;

  // ── S84 — Filas 2 + 3 (renderKpiStrip) ─────────────────────────────────
  //
  // Renderiza Filas 2 y 3 dentro del contenedor #kpi-strip-section.
  //
  //   Fila 2 (4 cajas): Preaut+ hoy · Daily Preaut+ avg · Proy. Cierres EOM
  //                     · Proy. Inversión EOM
  //   Fila 3 (2 cajas): CAC Preaut+ · CAC Cierres con chip vs objetivo
  //
  // En periodos != mtd, las 3 cajas mtd-only (Daily avg, Proy Cierres,
  // Proy Inversión) se omiten — Fila 2 se reduce a la caja Preaut+ con
  // delta vs periodo previo.
  //
  // Per spec: Preaut+ con delta=0 NO se pinta rojo (sheet llega con retraso
  // — un cero no es una baja confirmable). _deltaLineHTML ya rinde el
  // delta=0 en gris neutral, así que no requiere override.
  //
  // CAC null (denominador 0) muestra "—", nunca "$0". Chip vs objetivo:
  //   - CAC Preaut+: vs costo_preaut_positivo_objetivo (934 hoy).
  //   - CAC Cierres: vs cac_objetivo / cac_meta (2833 hoy).
  // Status: backend ship costo_preaut_positivo_status hoy (red); cac_status
  // viene null cuando cierres=0. Donde el status no esté disponible se
  // computa client-side basado en value <= obj.

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

  // S82 — Per-period delta sub-label (mirror of enpagos-daily.js:297-314
  // deltaSubLabelFor). Returns the COMPLETE "vs X" phrase (incluye prefijo).
  // Cada period tiene su frasing canónico — daily-parity:
  //   today      → "vs ayer"
  //   yesterday  → "vs anteayer"
  //   7d         → "vs 7d anteriores"
  //   30d        → "vs 30d anteriores"
  //   mtd        → "vs ABRIL (1-28)" (computado dinámicamente)
  //   last_month → "vs periodo anterior"
  function _formatPreviousLabel(period, data) {
    if (period === 'today')     return 'vs ayer';
    if (period === 'yesterday') return 'vs anteayer';
    if (period === '7d')        return 'vs 7d anteriores';
    if (period === '30d')       return 'vs 30d anteriores';
    if (period === 'mtd') {
      var range = _formatPreviousRange(data && data.meta && data.meta.previous_period);
      if (range === 'periodo anterior') return 'vs mes anterior';
      return 'vs ' + range;
    }
    return 'vs periodo anterior';
  }

  function _deltaLineHTML(absDelta, pctDelta, periodLabel, opts) {
    // Priority: _abs first (more useful for these counting metrics).
    // Falls through to _pct if no _abs but pct is present and sane.
    // Returns gray "—" placeholder when neither is meaningful.
    //
    // opts.invertColor: when true (CAC, costo_preaut_positivo), positive delta
    // is BAD (red) and negative is GOOD (green). Daily uses this for CAC; we
    // mirror exact same semantics. Default false (direct color).
    // opts.suppressZero: when true, omit the entire delta line for delta === 0
    // (avoids visual noise on dead periods). Default false.
    var invert = !!(opts && opts.invertColor);
    var suppressZero = !!(opts && opts.suppressZero);
    var label = ' ' + escapeHtml(periodLabel);
    var up = invert ? 'kpi-delta--down' : 'kpi-delta--up';
    var down = invert ? 'kpi-delta--up' : 'kpi-delta--down';

    if (absDelta != null && !isNaN(absDelta)) {
      var n = Number(absDelta);
      if (n > 0) {
        return '<div class="kpi-delta ' + up + '">▲ +' + _fmtInt(n) + label + '</div>';
      }
      if (n < 0) {
        return '<div class="kpi-delta ' + down + '">▼ ' + _fmtInt(n) + label + '</div>';
      }
      if (suppressZero) return '';
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
      var cls = p > 0 ? up : (p < 0 ? down : 'kpi-delta--zero');
      var arrow = p > 0 ? '▲ ' : (p < 0 ? '▼ ' : '— ');
      if (suppressZero && p === 0) return '';
      return '<div class="kpi-delta ' + cls + '">' + arrow + pctStr + label + '</div>';
    }
    // Neither _abs nor _pct → missing. Show "—" same color as zero, no number.
    return '<div class="kpi-delta kpi-delta--missing">—' + label + '</div>';
  }

  function _kpiCardHTML(opts) {
    // opts: { label, valueHTML, auxHTML?, subHTML?, chipHTML?, deltaHTML? }
    var aux = opts.auxHTML
      ? ' <span class="kpi-card__aux">' + opts.auxHTML + '</span>'
      : '';
    var sub = opts.subHTML
      ? '<div class="kpi-card__sub">' + opts.subHTML + '</div>'
      : '';
    var chip = opts.chipHTML
      ? '<div class="kpi-card__chip-row">' + opts.chipHTML + '</div>'
      : '';
    return (
      '<div class="kpi-card">' +
        '<div class="kpi-card__label">' + escapeHtml(opts.label) + '</div>' +
        '<div class="kpi-card__big">' + opts.valueHTML + aux + '</div>' +
        sub +
        chip +
        (opts.deltaHTML || '') +
      '</div>'
    );
  }

  // Status CAC: actual <= objetivo → green; objetivo < actual <= limite →
  // yellow; actual > limite → red. Sin limite, fallback green/red contra
  // objetivo. Cuando actual o objetivo son null → '', neutral.
  function _cacStatus(actual, objetivo, limite) {
    if (actual == null || isNaN(actual)) return '';
    if (objetivo == null || isNaN(objetivo)) return '';
    var a = Number(actual);
    var o = Number(objetivo);
    if (a <= o) return 'green';
    if (limite != null && !isNaN(limite)) {
      return (a <= Number(limite)) ? 'yellow' : 'red';
    }
    return 'red';
  }

  function _cacChipHTML(status, objetivoText) {
    if (!status || !objetivoText) return '';
    var label;
    if (status === 'green') label = 'Bajo objetivo';
    else if (status === 'yellow') label = 'Sobre objetivo';
    else label = 'Sobre límite';
    return '<span class="kpi-chip kpi-chip--' + status + '">' +
             escapeHtml(label) + ' (' + objetivoText + ')' +
           '</span>';
  }

  function renderKpiStrip(data, period) {
    var sec = document.getElementById('kpi-strip-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    var current     = (data.totals && data.totals.current)     || {};
    var delta       = (data.totals && data.totals.delta)       || {};
    var projection  = (data.totals && data.totals.projection)  || {};
    var vsGoal      = (data.totals && data.totals.vs_goal)     || {};
    var goals       = data.goals                               || {};
    var isMtd       = (period === 'mtd');
    var periodLabel = _formatPreviousLabel(period, data);

    // ── Fila 2 ────────────────────────────────────────────────────────
    // Caja 1 — Preaut+ hoy (mtd) vs Preaut+ del periodo (otros periods).
    //
    // En mtd: patrón "Today's RX" del SPEC F0B7Q4VK4TE. Valor grande =
    // preaut+ de HOY (length de totals.today_preaut_positivos, viene en
    // el MTD payload — no hacemos segundo fetch). Badge = déficit de
    // ritmo del día contra el ritmo necesario para cumplir la meta
    // mensual en los días hábiles restantes:
    //
    //   dias_habiles_restantes = projection.business_days_total
    //                          − projection.business_days_passed
    //   preaut_restantes = goals.preaut_positivos_goal − current.preaut_positivos
    //   ritmo_necesario  = preaut_restantes / dias_habiles_restantes
    //   pace_delta       = preaut_hoy − ritmo_necesario
    //
    // pace_delta < 0 → rojo (atrasado). >= 0 → verde (al ritmo o arriba).
    // Heredamos business_days_passed/total del backend en vez de
    // recontarlos: si el cron cambia su criterio (fines de semana,
    // feriados), la caja se mantiene cuadrada con Cierres/proyecciones.
    //
    // Gates de robustez:
    //   - dias_habiles_restantes <= 0 → fin de mes, sin badge, sub "mes cerrado".
    //   - goal mensual ausente → degradar a solo conteo de hoy (sin badge
    //     ni sub de ritmo), patrón consistente con "meta pendiente" de Cierres.
    //   - preaut_restantes <= 0 → meta ya cumplida → ritmo = 0, pace_delta
    //     siempre verde (no penalizamos un cero cuando ya terminaste).
    //
    // En otros periods: degrada a "Preaut+ del periodo" con delta vs
    // periodo previo (comportamiento del bloque superior original).
    var preautVal = current.preaut_positivos;
    var costoPreaut = current.costo_preaut_positivo;
    var f2Boxes = [];
    if (isMtd) {
      var todayFeed = data.totals && data.totals.today_preaut_positivos;
      var preautHoy = Array.isArray(todayFeed) ? todayFeed.length : 0;
      var bdTotal  = projection.business_days_total;
      var bdPassed = projection.business_days_passed;
      var bdRestantes = (bdTotal != null && bdPassed != null)
        ? (Number(bdTotal) - Number(bdPassed)) : null;
      var goalPreautMo = (goals.preaut_positivos_goal &&
                          goals.preaut_positivos_goal.valor) ||
                         (goals.preaut_positivos_meta &&
                          goals.preaut_positivos_meta.valor);

      var monthClosed = (bdRestantes != null && bdRestantes <= 0);
      var goalMissing = (goalPreautMo == null);

      var ritmoNec = null;
      if (!monthClosed && !goalMissing && bdRestantes > 0) {
        var restantes = Number(goalPreautMo) - Number(preautVal != null ? preautVal : 0);
        if (restantes < 0) restantes = 0;
        ritmoNec = restantes / bdRestantes;
      }

      var paceBadgeHTML = '';
      var subHoy = '';
      if (monthClosed) {
        subHoy = 'mes cerrado';
      } else if (goalMissing) {
        subHoy = '';
      } else if (ritmoNec != null) {
        var paceDelta = preautHoy - ritmoNec;
        var cls = (paceDelta >= 0) ? 'green' : 'red';
        var sign = (paceDelta >= 0) ? '+' : '';
        paceBadgeHTML = '<span class="kpi-chip kpi-chip--' + cls + '">' +
                        sign + paceDelta.toFixed(1) + '/día</span>';
        subHoy = 'vs ' + ritmoNec.toFixed(1) + '/día hábil necesario';
      }

      f2Boxes.push(_kpiCardHTML({
        label: 'Preaut+ hoy',
        valueHTML: _fmtInt(preautHoy),
        chipHTML:  paceBadgeHTML,
        subHTML:   subHoy
      }));
    } else {
      // Non-mtd: degrade to count + delta vs previous (sin AUX inline de CAC,
      // sin sub de "sheet con retraso" — esos eran del bloque mtd antiguo
      // que ahora vive en la caja "Preaut+ hoy" con su propio badge).
      f2Boxes.push(_kpiCardHTML({
        label: 'Preaut+ del periodo',
        valueHTML: _fmtInt(preautVal),
        deltaHTML: _deltaLineHTML(
          delta.preaut_positivos_abs, null, periodLabel, { invertColor: false }
        )
      }));
    }

    if (isMtd) {
      // Daily Preaut+ avg = preaut / business_days_passed. Backend no ship
      // preaut_avg directo, lo computamos.
      var bdp = projection.business_days_passed;
      var dailyAvg = (preautVal != null && bdp != null && bdp > 0)
        ? (Number(preautVal) / Number(bdp))
        : null;
      f2Boxes.push(_kpiCardHTML({
        label: 'Daily Preaut+ avg',
        valueHTML: (dailyAvg != null) ? _fmtFloat2(dailyAvg) : '—',
        subHTML:   (bdp != null) ? bdp + ' días hábiles transcurridos' : ''
      }));

      var projC = projection.projected_cierres_eom;
      var cierresMo = goals.cierres_meta && goals.cierres_meta.valor;
      f2Boxes.push(_kpiCardHTML({
        label: 'Proy. Cierres EOM',
        valueHTML: (projC != null) ? _fmtInt(projC) : '—',
        subHTML:   (cierresMo != null) ? 'vs meta ' + _fmtInt(cierresMo) : ''
      }));

      var projInv = projection.projected_inversion_eom;
      var invMo   = (goals.inversion_meta && goals.inversion_meta.valor) ||
                    (goals.inversion_planeada && goals.inversion_planeada.valor);
      f2Boxes.push(_kpiCardHTML({
        label: 'Proy. Inversión EOM',
        valueHTML: (projInv != null && projInv > 0) ? _fmtCurrency(projInv) : '—',
        subHTML:   (invMo != null) ? 'vs plan ' + _fmtCurrency(invMo) : ''
      }));
    }

    var fila2HTML = '<div class="row2-grid" data-mtd="' + (isMtd ? '1' : '0') + '">' +
                    f2Boxes.join('') +
                    '</div>';

    // ── Fila 3 — CAC Preaut+ + CAC Cierres ────────────────────────────
    var costoPreautObj    = goals.costo_preaut_positivo_objetivo &&
                            goals.costo_preaut_positivo_objetivo.valor;
    var costoPreautLimite = goals.costo_preaut_positivo_limite &&
                            goals.costo_preaut_positivo_limite.valor;
    var costoPreautStatus = (preautVal != null && preautVal > 0)
      ? (vsGoal.costo_preaut_positivo_status ||
         _cacStatus(costoPreaut, costoPreautObj, costoPreautLimite))
      : '';
    var costoPreautChip = (costoPreautObj != null && preautVal != null && preautVal > 0)
      ? _cacChipHTML(costoPreautStatus, 'obj ' + _fmtCurrency(costoPreautObj))
      : '';

    var cacVal    = current.cac;
    var cacObj    = (goals.cac_objetivo && goals.cac_objetivo.valor) ||
                    (goals.cac_meta && goals.cac_meta.valor);
    var cacLimite = goals.cac_limite && goals.cac_limite.valor;
    var hasCierres = (current.cierres != null && current.cierres > 0);
    var cacStatus  = hasCierres
      ? (vsGoal.cac_status || _cacStatus(cacVal, cacObj, cacLimite))
      : '';
    var cacChip = (cacObj != null && hasCierres)
      ? _cacChipHTML(cacStatus, 'obj ' + _fmtCurrency(cacObj))
      : '';

    var cacPreautText = (preautVal != null && preautVal > 0 &&
                         costoPreaut != null && !isNaN(costoPreaut))
      ? _fmtCurrency(costoPreaut) : '—';
    var cacCierresText = hasCierres
      ? ((cacVal != null) ? _fmtCurrency(cacVal) : '—')
      : '—';

    // S89-firmas-proy — 3ª caja "CAC próximo": inversion ÷ (cierres + firmas
    // programadas). Mismo helper _cacProximoText que el plaza card; aplicado
    // ahora a totales globales. Cuando firmas <= 0, _cacProximoText retorna
    // null → forzamos "—" en valueHTML y subHTML explicativo. SIN chip en v1
    // (decisión Anwar: el "objetivo" para CAC próximo no está formalizado).
    var firmasGlobal = current.firmas_programadas;
    var invAtribGlobal = current.inversion_atribuida;
    var cacProxText = _cacProximoText(invAtribGlobal, current.cierres, firmasGlobal);
    if (cacProxText == null) cacProxText = '—';
    var cacProxSub = (firmasGlobal != null && firmasGlobal > 0)
      ? 'si cierran las ' + _fmtInt(firmasGlobal) +
        ' firma' + (firmasGlobal === 1 ? '' : 's')
      : 'sin firmas programadas';

    var fila3HTML = '<div class="row3-grid">' +
      _kpiCardHTML({
        label: 'CAC Preaut+',
        valueHTML: cacPreautText,
        chipHTML:  costoPreautChip,
        subHTML:   (preautVal == null || preautVal === 0) ? 'sin preaut+ en el periodo' : '',
        deltaHTML: _deltaLineHTML(
          null, delta.costo_preaut_positivo_pct, periodLabel,
          { invertColor: true }
        )
      }) +
      _kpiCardHTML({
        label: 'CAC Cierres',
        valueHTML: cacCierresText,
        chipHTML:  cacChip,
        subHTML:   hasCierres ? '' : 'sin cierres en el periodo',
        deltaHTML: _deltaLineHTML(
          null, delta.cac_pct, periodLabel, { invertColor: true }
        )
      }) +
      _kpiCardHTML({
        label: 'CAC próximo',
        valueHTML: cacProxText,
        chipHTML:  '',                          // omit: sin chip en v1
        subHTML:   cacProxSub
      }) +
      '</div>';

    sec.innerHTML = fila2HTML + fila3HTML;
  }

  window.__renderKpiStrip = renderKpiStrip;

  function renderPreautFamilia(data) {
    var sec = document.getElementById('preaut-familia-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') { sec.innerHTML = ''; return; }
    var byFamily   = (data.totals && data.totals.by_family) || {};
    var goals      = data.goals || {};
    var objetivo   = (goals.costo_preaut_positivo_objetivo && goals.costo_preaut_positivo_objetivo.valor) || null;
    var spendMixto = (data.totals && data.totals.spend_mixto) || 0;
    var CANON = { 'MAQUINA DE HIELO':1, 'CONGELADOR':1, 'ENFRIADOR':1, 'VITRINAS':1, 'PROCESAMIENTO':1 };
    var withCost = [], without = [], residualN = 0;
    for (var fam in byFamily) {
      if (!Object.prototype.hasOwnProperty.call(byFamily, fam)) continue;
      var f = byFamily[fam] || {};
      var n = Number(f.preaut_positivos) || 0;
      if (!CANON[fam]) { residualN += n; continue; }
      var costo = f.costo_por_preaut_positivo;
      var noCampaign = (f.attribution_status === 'no_dedicated_campaign') || costo == null;
      if (noCampaign) { without.push({ fam: fam, n: n }); }
      else { withCost.push({ fam: fam, n: n, costo: Number(costo) }); }
    }
    if (withCost.length === 0 && without.length === 0 && residualN === 0) { sec.innerHTML = ''; return; }
    withCost.sort(function (a, b) { return a.costo - b.costo; });
    without.sort(function (a, b) { return b.n - a.n; });
    var maxCosto = withCost.length ? withCost[withCost.length - 1].costo : 0;
    function tier(costo) {
      if (!objetivo) return 'none';
      if (costo <= objetivo)       return 'green';
      if (costo <= objetivo * 1.5) return 'amber';
      return 'red';
    }
    var rows = '';
    for (var i = 0; i < withCost.length; i++) {
      var it = withCost[i];
      var pct = maxCosto > 0 ? Math.round((it.costo / maxCosto) * 100) : 0;
      rows += '<div class="pf-row"><span class="pf-fam">' + escapeHtml(it.fam) + '</span>' +
        '<div class="pf-bar"><div class="pf-bar-fill pf-bar-fill--' + tier(it.costo) + '" style="width:' + pct + '%"></div></div>' +
        '<span class="pf-num"><span class="pf-cost">' + _fmtCurrency(it.costo) + '</span><span class="pf-n">' + _fmtInt(it.n) + ' preaut+</span></span></div>';
    }
    for (var k = 0; k < without.length; k++) {
      var w = without[k];
      rows += '<div class="pf-row"><span class="pf-fam pf-fam--muted">' + escapeHtml(w.fam) + '</span>' +
        '<span class="pf-nocamp">sin campaña dedicada</span>' +
        '<span class="pf-num"><span class="pf-n">' + _fmtInt(w.n) + ' preaut+</span></span></div>';
    }
    var legend = objetivo ? '<div class="pf-legend"><span class="pf-leg"><span class="pf-sw pf-sw--amber"></span>hasta 1.5x meta</span><span class="pf-leg"><span class="pf-sw pf-sw--red"></span>arriba de 1.5x</span><span class="pf-leg-meta">meta ' + _fmtCurrency(objetivo) + ' / preaut+</span></div>' : '';
    var notes = '';
    if (spendMixto > 0) notes += '<div class="pf-foot">+ ' + _fmtCurrency(spendMixto) + ' en campanas multi-familia (spend mixto), no atribuible a una sola linea.</div>';
    if (residualN > 0) notes += '<div class="pf-foot">+ ' + _fmtInt(residualN) + ' preaut+ sin familia clasificada.</div>';
    sec.innerHTML = '<div class="pf-card"><div class="pf-head"><span class="pf-title">Preaut+ por familia</span><span class="pf-sub">costo por preaut+ - global del mes</span></div>' + legend + rows + notes + '</div>';
  }
  window.__renderPreautFamilia = renderPreautFamilia;

  // ── F3.6 Plaza cards — 11 cards, table 5 rows + footer CIERRES/CAC ─────
  //
  // Mirror visual de la card que daily renderiza en cardHtml() de
  // enpagos-daily.js:533. Replico INLINE (no importar daily, no tocar
  // daily) — patrón establecido en F3.x: daily CSS está scoped a
  // .app-redesign con design tokens, esta vista standalone no los carga.
  //
  // Data source: data.by_city — MAP keyed por nombre de plaza con
  // espacios ("NUEVO LEON", "GUADALAJARA"). 11 plazas: 9 regulares + 2
  // especiales (ORGANICOS, SIN-ATRIBUCION).
  //
  // Diferencia explícita vs daily (per SPEC F3.6):
  // - Daily oculta especiales cuando todo está en 0 (shouldHideSpecial).
  //   F3.6 SIEMPRE renderiza las 11 plazas, aunque estén en cero.
  //
  // Renders por fila (todas leen de by_city.{plaza}.current):
  //   Inversión          → inversion_atribuida (solo valor $, sin conteo)
  //   Preautorizados     → leads_brutos (count) + CPA inv/leads_brutos
  //                          ⚠️ count viene de leads_brutos, NO preaut_*
  //   Preaut+            → preaut_positivos (count) + CPA inv/preaut_pos
  //   Cancelados         → cancelados (count, SIN $ — Anwar S60)
  //   Firmas Programadas → firmas_programadas (count) + CPA inv/firmas
  //   Footer             → "CIERRES N | CAC $X" (— si cierres===0)
  //
  // Variant B (cierres===0 && preaut_positivos>0): CAC muestra "—" y
  // foot string literal "Preaut+ sin cierre — data de referencia". Hoy
  // en PROD aplica a BAJIO-GUANAJUATO y CHIHUAHUA.
  //
  // Status chip (header right): usa cac_status enum `red|amber|green`
  // (NOT yellow — alinéate con daily; F3.2 Goals usó yellow por drift).
  // Chip solo cuando current.cierres > 0 (sin denominador, sin chip).

  function _cpaText(inversion, count) {
    // Replica de daily cpaText() (enpagos-daily.js:485-489).
    if (!count || count <= 0) return '—';
    if (inversion == null || isNaN(inversion)) return '—';
    return _fmtCurrency(inversion / count);
  }

  // CAC PRÓXIMO = inversion_atribuida ÷ (cierres + firmas_programadas).
  // Reemplaza al cálculo viejo `inv / firmas_programadas` para la fila
  // "Firmas Programadas" del plaza card. Las firmas programadas son
  // cierres en pipeline a punto de materializarse, así que el numerador
  // inversión se imputa contra el funnel-completo-a-la-fecha (cierres ya
  // cerrados + los que están en visita firmada). El cálculo viejo daba
  // valores engañosamente altos (ej. NUEVO LEON 11729/2 = $5,865); con
  // la métrica correcta queda 11729/(5+2) = $1,676.
  //
  // Reglas de display (Anwar S89-firmas-hotfix):
  //   - firmas_programadas <= 0  → no se muestra CAC (sólo conteo).
  //     Retorna null → _plazaMetricRowWithCpaHtml emite span vacío y
  //     conserva el grid 3-col.
  //   - (cierres + firmas) <= 0  → "—" (safety net; con firmas > 0 el
  //     denominador siempre es ≥ 1 pero el guard cubre data sucia).
  //   - inv null/NaN → "—".
  //   - resto → $fmt(inv / (cierres + firmas)).
  function _cacProximoText(inversion, cierres, firmas) {
    if (!firmas || firmas <= 0) return null;
    var denom = (cierres || 0) + firmas;
    if (denom <= 0) return '—';
    if (inversion == null || isNaN(inversion)) return '—';
    return _fmtCurrency(inversion / denom);
  }

  function _plazaVariant(current) {
    // Replica de daily variantOf() (enpagos-daily.js:457-467).
    var cierres = (current && current.cierres) || 0;
    var preaut  = (current && current.preaut_positivos) || 0;
    var leads   = (current && current.leads_brutos) || 0;
    var spend   = (current && current.inversion_atribuida) || 0;
    if (cierres > 0) return 'A';
    if (preaut > 0)  return 'B';
    if (leads > 0)   return 'D';
    if (spend > 0)   return 'E';
    return 'C';
  }

  function _plazaFootMessage(variant) {
    // Replica de daily variantFootMessage() (enpagos-daily.js:474-480).
    if (variant === 'B') return 'Preaut+ sin cierre — data de referencia';
    if (variant === 'D') return 'Lead sin calificar — revisar tráfico';
    if (variant === 'E') return 'Revisar mapping ads → plaza';
    if (variant === 'C') return 'Sin actividad en el periodo';
    return '';
  }

  function _plazaChipForStatus(cacStatus) {
    // Match daily chipSpecFor() (enpagos-daily.js:282-287). Enum: red/amber/green.
    if (cacStatus === 'red')   return { className: 'plaza-card__chip--red',   label: 'FUERA DE META' };
    if (cacStatus === 'amber') return { className: 'plaza-card__chip--amber', label: 'CERCA DE META' };
    if (cacStatus === 'green') return { className: 'plaza-card__chip--green', label: 'EN META' };
    return null;
  }

  function _plazaMetricRowHtml(label, valueHTML) {
    // Fila Inversión: solo label + valor (sin slot CPA).
    return (
      '<div class="plaza-card__row plaza-card__row--simple">' +
        '<span class="plaza-card__row-label">' + escapeHtml(label) + '</span>' +
        '<span class="plaza-card__row-value">' + valueHTML + '</span>' +
      '</div>'
    );
  }

  function _plazaMetricRowWithCpaHtml(label, valueHTML, cpaHTML, subLabel) {
    // Filas Preautorizados / Preaut+ / Cancelados / Firmas: 3 columnas
    // (label | cpa | count). Cuando cpaHTML es null → span vacío para
    // mantener el grid alineado (igual que daily).
    //
    // S89-9 — subLabel opcional: microcopy bajo el label principal
    // (ej. "si cierran las 2 firmas" en la fila Firmas Programadas).
    // Backward-compatible: si subLabel falsy, label sale como antes.
    var cpaSpan = (cpaHTML != null && cpaHTML !== '')
      ? '<span class="plaza-card__row-cpa">' + cpaHTML + '</span>'
      : '<span class="plaza-card__row-cpa plaza-card__row-cpa--empty" aria-hidden="true"></span>';
    var labelHTML = subLabel
      ? '<div class="plaza-card__row-label-wrap">' +
          '<span class="plaza-card__row-label">' + escapeHtml(label) + '</span>' +
          '<span class="plaza-card__row-sublabel">' + escapeHtml(subLabel) + '</span>' +
        '</div>'
      : '<span class="plaza-card__row-label">' + escapeHtml(label) + '</span>';
    return (
      '<div class="plaza-card__row plaza-card__row--with-cpa">' +
        labelHTML +
        cpaSpan +
        '<span class="plaza-card__row-value">' + valueHTML + '</span>' +
      '</div>'
    );
  }

  // ── S89-9 — Filas colapsables (Rechazados / Cancelados) ──
  // Patrón: <details>/<summary> nativo (cero JS). Marker propio ▸→▾ vía
  // rotación CSS al estado [open]. Cuando no hay sub-filas o N=0, se
  // emite una fila simple sin triángulo (no hay nada que desplegar).

  function _plazaSubRowHtml(label, n) {
    return (
      '<div class="plaza-card__subrow">' +
        '<span class="plaza-card__subrow-label">' + escapeHtml(label) + '</span>' +
        '<span class="plaza-card__subrow-value">' + _fmtInt(n) + '</span>' +
      '</div>'
    );
  }

  function _plazaCollapsibleRowHtml(label, n, subRowsHtml, cpaHTML) {
    // Fila colapsable. Grid 3-col (label | cpa | count).
    // cpaHTML opcional: si viene, se pinta en la columna CPA; si no, span vacio.
    // Rechazados/Cancelados llaman sin cpa; Preaut+ pasa su costo/preaut+.
    // Si n<=0 o no hay sub-filas: fila simple (sin triangulo, sin details).
    var cpaSpan = (cpaHTML != null && cpaHTML !== '')
      ? '<span class="plaza-card__row-cpa">' + cpaHTML + '</span>'
      : '<span class="plaza-card__row-cpa plaza-card__row-cpa--empty" aria-hidden="true"></span>';
    if (!n || n <= 0 || !subRowsHtml) {
      return (
        '<div class="plaza-card__row plaza-card__row--with-cpa">' +
          '<span class="plaza-card__row-label">' + escapeHtml(label) + '</span>' +
          cpaSpan +
          '<span class="plaza-card__row-value">' + _fmtInt(n) + '</span>' +
        '</div>'
      );
    }
    return (
      '<details class="plaza-card__details">' +
        '<summary class="plaza-card__row plaza-card__row--with-cpa plaza-card__row--collapsible">' +
          '<span class="plaza-card__row-label">' +
            '<span class="plaza-card__marker" aria-hidden="true">▸</span>' +
            escapeHtml(label) +
          '</span>' +
          cpaSpan +
          '<span class="plaza-card__row-value">' + _fmtInt(n) + '</span>' +
        '</summary>' +
        '<div class="plaza-card__subrows">' + subRowsHtml + '</div>' +
      '</details>'
    );
  }

  function _buildPreautPorFamiliaSubRows(byFamily) {
    // S89-9b P2 - desglose de Preaut+ por familia. SOLO conteo: a nivel celda
    // plaza x familia el denominador de spend es ~1 -> costo seria ruido
    // (ver SPEC DISENO F0B7Q4VK4TE). Familia viene del lead (~100% cobertura).
    // Solo familias con N>0. Keys ya normalizadas a las 5 canonicas por backend.
    var bf = byFamily || {};
    var items = [];
    for (var fam in bf) {
      if (Object.prototype.hasOwnProperty.call(bf, fam)) {
        var n = Number(((bf[fam] || {}).preaut_positivos)) || 0;
        if (n > 0) items.push({ label: fam, n: n });
      }
    }
    items.sort(function (a, b) { return b.n - a.n; });
    return items.map(function (it) { return _plazaSubRowHtml(it.label, it.n); }).join('');
  }

  function _buildRechazadosSubRows(byRejectionReason) {
    // Etiquetas legibles para los 3 motivos canónicos del backend S89.
    var br = byRejectionReason || {};
    var labels = { buro: 'Buró', comite: 'Comité', capacidad: 'Capacidad' };
    var items = [];
    for (var key in br) {
      if (Object.prototype.hasOwnProperty.call(br, key)) {
        var n = Number(br[key]) || 0;
        if (n > 0) items.push({ label: labels[key] || key, n: n });
      }
    }
    items.sort(function (a, b) { return b.n - a.n; });
    return items.map(function (it) { return _plazaSubRowHtml(it.label, it.n); }).join('');
  }

  function _buildCanceladosSubRows(byCancellationReason, totalCancelados) {
    // Las razones las teclea un humano — escapeHtml en label es load-bearing.
    // Edge case: cancelados>0 pero el dict viene vacío o no suma. Fallback
    // explícito "Sin motivo registrado" para que el ▼ siga teniendo qué
    // mostrar (palanca deliberada).
    var bc = byCancellationReason || {};
    var items = [];
    for (var razon in bc) {
      if (Object.prototype.hasOwnProperty.call(bc, razon)) {
        var n = ((bc[razon] || {}).count) || 0;
        if (n > 0) items.push({ label: razon, n: n });
      }
    }
    items.sort(function (a, b) { return b.n - a.n; });
    var sumDict = items.reduce(function (s, it) { return s + it.n; }, 0);
    if ((totalCancelados || 0) > 0 && sumDict === 0) {
      items.push({ label: 'Sin motivo registrado', n: totalCancelados });
    }
    return items.map(function (it) { return _plazaSubRowHtml(it.label, it.n); }).join('');
  }

  function _plazaFooterHtml(cierres, cacText, venta) {
    // S89 — Footer L1: CIERRES · CAC (existente).
    //       Footer L2: VENTA $monto completo sin abreviar (SPEC F0B7Q4VK4TE).
    // venta=null/undefined → "—" via _fmtCurrency; venta=0 → "$0"; nunca
    // se oculta la fila (decisión explícita: usuario quiere ver el cero
    // como señal, no como ausencia).
    return (
      '<div class="plaza-card__footer">' +
        '<span class="plaza-card__footer-label">CIERRES</span>' +
        '<span class="plaza-card__footer-value">' + _fmtInt(cierres) + '</span>' +
        '<span class="plaza-card__footer-sep">|</span>' +
        '<span class="plaza-card__footer-label">CAC</span>' +
        '<span class="plaza-card__footer-value">' + cacText + '</span>' +
      '</div>' +
      '<div class="plaza-card__footer-venta">' +
        '<span class="plaza-card__footer-label">VENTA</span>' +
        '<span class="plaza-card__footer-value">' + _fmtCurrency(venta) + '</span>' +
      '</div>'
    );
  }

  function _plazaCardHtml(plaza, city) {
    var current = (city && city.current) || {};
    var vsGoal  = (city && city.vs_goal) || {};
    var variant = _plazaVariant(current);

    // Chip header (solo cuando hay cierres → CAC tiene denominador).
    var chip = (current.cierres > 0) ? _plazaChipForStatus(vsGoal.cac_status) : null;
    var chipHtml = chip
      ? '<span class="plaza-card__chip ' + chip.className + '">' + escapeHtml(chip.label) + '</span>'
      : '';

    // CAC text: "—" cuando cierres === 0 (variantes B/C/D/E todas caen aquí).
    var cacText = (current.cierres > 0)
      ? _fmtCurrency(current.cac)
      : '—';

    var inv = current.inversion_atribuida;

    // S89-9 — Filas colapsables (Rechazados / Cancelados)
    // se construyen ANTES del template para mantener legible la composición.
    var rechazadosSubRows  = _buildRechazadosSubRows(city && city.by_rejection_reason);
    var canceladosSubRows  = _buildCanceladosSubRows(city && city.by_cancellation_reason, current.cancelados);
    var preautFamiliaSubRows = _buildPreautPorFamiliaSubRows(city && city.by_family);

    // S89-9 — Microcopy de Firmas Programadas: "si cierra la 1 firma" /
    // "si cierran las N firmas". Solo cuando firmas > 0 (sin firmas no hay
    // CAC próximo, sin CAC próximo no hay contexto que explicar).
    var fp = Number(current.firmas_programadas) || 0;
    var firmasSubLabel = '';
    if (fp > 0) {
      firmasSubLabel = (fp === 1)
        ? 'si cierra la 1 firma'
        : 'si cierran las ' + fp + ' firmas';
    }

    var rows = ''
      + _plazaMetricRowHtml('Inversión', _fmtCurrency(inv))
      + _plazaMetricRowWithCpaHtml('Preautorizados',     _fmtInt(current.leads_brutos),        _cpaText(inv, current.leads_brutos))
      + _plazaCollapsibleRowHtml('Rechazados',           current.rechazados,                   rechazadosSubRows)
      + _plazaCollapsibleRowHtml('Preaut+',            current.preaut_positivos,            preautFamiliaSubRows, _cpaText(inv, current.preaut_positivos))
      + _plazaCollapsibleRowHtml('Cancelados',           current.cancelados,                   canceladosSubRows)
      + _plazaMetricRowWithCpaHtml('Firmas Programadas', _fmtInt(current.firmas_programadas),  _cacProximoText(inv, current.cierres, current.firmas_programadas), firmasSubLabel)
      + _plazaFooterHtml(current.cierres, cacText, current.venta);

    var footMsg = _plazaFootMessage(variant);
    var footMsgHtml = footMsg
      ? '<div class="plaza-card__foot-msg">' + escapeHtml(footMsg) + '</div>'
      : '';

    return (
      '<div class="plaza-card" data-variant="' + escapeHtml(variant) + '" data-plaza="' + escapeHtml(plaza) + '">' +
        '<div class="plaza-card__header">' +
          '<h3 class="plaza-card__title">' + escapeHtml(plaza) + '</h3>' +
          chipHtml +
        '</div>' +
        '<div class="plaza-card__body">' + rows + '</div>' +
        footMsgHtml +
      '</div>'
    );
  }

  function renderPlazaCards(data) {
    var sec = document.getElementById('plaza-cards-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    var byCity = data.by_city;
    if (!byCity || typeof byCity !== 'object' || Object.keys(byCity).length === 0) {
      sec.innerHTML = '';
      return;
    }

    // Sort: regulares (sorted DESC por inversion_atribuida) + especiales al final.
    // Mismo orden que daily (enpagos-daily.js:432-447). Spec F3.6: NO ocultar
    // especiales aunque estén en cero — sus cards siguen apareciendo con
    // foot "Sin actividad en el periodo".
    var SPECIAL_PLAZAS = ['ORGANICOS', 'SIN-ATRIBUCION'];
    var isSpecial = function (p) { return SPECIAL_PLAZAS.indexOf(p) !== -1; };

    var allPlazas = Object.keys(byCity);
    var regulares = allPlazas.filter(function (p) { return !isSpecial(p); });
    var especiales = SPECIAL_PLAZAS.filter(function (p) {
      return Object.prototype.hasOwnProperty.call(byCity, p);
    });

    regulares.sort(function (a, b) {
      var invA = ((byCity[a] && byCity[a].current) || {}).inversion_atribuida || 0;
      var invB = ((byCity[b] && byCity[b].current) || {}).inversion_atribuida || 0;
      return invB - invA;
    });

    var ordered = regulares.concat(especiales);
    var cardsHtml = ordered.map(function (plaza) {
      return _plazaCardHtml(plaza, byCity[plaza] || {});
    }).join('');

    sec.innerHTML = '<div class="plaza-cards-grid">' + cardsHtml + '</div>';
  }

  window.__renderPlazaCards = renderPlazaCards;

  // ── F3.5 TodayDetailFeed — table of today's preautorized leads ─────────
  //
  // Data: totals.today_preaut_positivos — array of lead objects from
  // resultado_ventas backend. Shape per SPEC: { plaza, precio, campana }.
  // Today's PROD returns length 0 → EmptyState fires.
  //
  // EmptyState reuse decision: assets/components/EmptyState.js exists with
  // window.EmptyState.html(props) API. BUT its companion EmptyState.css is
  // scoped to .app-redesign and depends on design-token CSS vars not loaded
  // by this standalone view (same blocker as ProgressBar / Goal chip
  // status colors → I'm following the established F3.x pattern of inlining
  // a minimal element in the home stylesheet rather than dragging in the
  // design system mid-flight). Refactor to use EmptyState.create() lands
  // when Home migrates to .app-redesign (post-F3.8).
  //
  // Mobile <768px: stack vertical (label/value pairs per card). NOT
  // horizontal scroll. Full mobile breakpoint is F3.7; here only the feed
  // gets the stacked treatment.

  function _todayFeedRow(item) {
    var plaza   = (item && item.plaza)   != null ? String(item.plaza)   : '—';
    var campana = (item && item.campana) != null ? String(item.campana) : '—';
    var precio  = (item && item.precio   != null && !isNaN(item.precio))
      ? _fmtCurrency(item.precio) : '—';
    return (
      '<div class="today-feed__row" role="row">' +
        '<div class="today-feed__cell today-feed__cell--plaza"   role="cell" data-label="Plaza">' + escapeHtml(plaza) + '</div>' +
        '<div class="today-feed__cell today-feed__cell--precio"  role="cell" data-label="Precio">' + escapeHtml(precio) + '</div>' +
        '<div class="today-feed__cell today-feed__cell--campana" role="cell" data-label="Campaña">' + escapeHtml(campana) + '</div>' +
      '</div>'
    );
  }

  function _todayFeedHeaderHTML() {
    return (
      '<div class="today-feed__header" role="row">' +
        '<div class="today-feed__cell today-feed__cell--plaza"   role="columnheader">Plaza</div>' +
        '<div class="today-feed__cell today-feed__cell--precio"  role="columnheader">Precio</div>' +
        '<div class="today-feed__cell today-feed__cell--campana" role="columnheader">Campaña</div>' +
      '</div>'
    );
  }

  function _emptyStateHTML(title, message) {
    // Inline equivalent of assets/components/EmptyState.html() — see
    // renderTodayDetailFeed docblock for why we don't reuse the component
    // wholesale today.
    return (
      '<div class="today-feed__empty" role="status">' +
        '<div class="today-feed__empty-icon" aria-hidden="true">⏳</div>' +
        '<div class="today-feed__empty-title">' + escapeHtml(title) + '</div>' +
        (message
          ? '<div class="today-feed__empty-msg">' + escapeHtml(message) + '</div>'
          : '') +
      '</div>'
    );
  }

  function renderTodayDetailFeed(data) {
    var sec = document.getElementById('today-detail-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') {
      sec.innerHTML = '';
      return;
    }
    var feed = data.totals && data.totals.today_preaut_positivos;
    // Defensive: backend may omit the array entirely OR return a non-array.
    // Treat both as "no data today" — EmptyState fires.
    if (!Array.isArray(feed) || feed.length === 0) {
      sec.innerHTML =
        '<div class="today-feed today-feed--empty">' +
          '<div class="today-feed__title">Preautorizados de hoy</div>' +
          _emptyStateHTML(
            'Sin preautorizados hoy',
            'Cuando llegue el primer preaut+ del día aparece aquí.'
          ) +
        '</div>';
      return;
    }

    var rowsHTML = '';
    for (var i = 0; i < feed.length; i++) {
      rowsHTML += _todayFeedRow(feed[i]);
    }
    sec.innerHTML =
      '<div class="today-feed" role="table" aria-label="Preautorizados de hoy">' +
        '<div class="today-feed__title">Preautorizados de hoy</div>' +
        '<div class="today-feed__grid">' +
          _todayFeedHeaderHTML() +
          rowsHTML +
        '</div>' +
      '</div>';
  }

  window.__renderTodayDetailFeed = renderTodayDetailFeed;

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
