// Inmobili Home — §22 Paridad EnPagos (staging).
// SPEC: Slack canvas F0B6FH740PN §22.
// Clone visual de enpagos-home.js, vocabulario y datos de Inmobili.
//
// Sections (mismos containers que EnPagos):
//   #goals-section            → Fila 1 (4 heros: Captac/Inversión/Citas/Venta)
//   #kpi-strip-section        → Fila 2 (Ritmo) + Fila 3 (CAC)
//   #plaza-cards-section      → 5 plaza cards (Torreón/Gómez/NL/Orgánicos/Sin-atribución)
//   #today-detail-section     → Feed "Captaciones de hoy"
//
// Diferencias clave vs EnPagos:
//   - Cierres NO se muestra como conteo (decisión cerrada SPEC).
//   - 4to hero = Venta (no Preaut+).
//   - Plaza cards con badges Fase 2 / Próximamente (no existen en EnPagos).
//   - CAC Cita peso completo (sin atenuar).
//   - Captaciones footer NO en rojo (gotcha de color §22).
(function () {
  'use strict';

  var HOME_VALID_PERIODS = ['mtd', 'last_month'];
  var DEFAULT_PERIOD = 'mtd';
  var ENDPOINT = 'https://optix-proxy.anwarhsg.workers.dev/client_data_public';
  var CLIENT = 'inmobili';
  var SKELETON_DEBOUNCE_MS = 300;

  var PERIOD_LABELS = {
    mtd: 'Este Mes',
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

  // ── Period selector ──────────────────────────────────────────────────
  function getInitialPeriod() {
    var hash = window.location.hash || '';
    var m = hash.match(/#period=([^&]+)/);
    if (m && HOME_VALID_PERIODS.indexOf(m[1]) !== -1) return m[1];
    try {
      var saved = window.localStorage.getItem('inmobili_home_period');
      if (saved && HOME_VALID_PERIODS.indexOf(saved) !== -1) return saved;
    } catch (e) { /* noop */ }
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
    if (loading) nav.classList.add('loading'); else nav.classList.remove('loading');
  }
  function onChipClick(evt) { switchPeriod(evt.currentTarget.getAttribute('data-period')); }
  function switchPeriod(newPeriod) {
    if (newPeriod === currentPeriod) return;
    if (currentController) { try { currentController.abort(); } catch (e) {} }
    try { window.location.hash = '#period=' + newPeriod; } catch (e) {}
    try { window.localStorage.setItem('inmobili_home_period', newPeriod); } catch (e) {}
    fetchAndRender(newPeriod);
  }

  // ── Fetch ────────────────────────────────────────────────────────────
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
        if (!resp.ok) { var err = new Error('HTTP ' + resp.status); err.status = resp.status; throw err; }
        return resp.json();
      })
      .then(function (data) {
        clearTimeout(skeletonTimer);
        hideSkeletons();
        if (currentPeriod !== period) return;
        window.__homeData = data;
        var sections = [
          ['renderGoals',           function () { renderGoals(data, period); }],
          ['renderKpiStrip',        function () { renderKpiStrip(data, period); }],
          ['renderPlazaCards',      function () { renderPlazaCards(data); }],
          ['renderTodayDetailFeed', function () { renderTodayDetailFeed(data); }]
        ];
        for (var i = 0; i < sections.length; i++) {
          try { sections[i][1](); }
          catch (renderErr) {
            console.error('[inmobili-home] render error in ' + sections[i][0] +
                          ' for period=' + period + ':', renderErr);
          }
        }
        clearBanner();
        setSelectorLoading(false);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        clearTimeout(skeletonTimer);
        hideSkeletons();
        setSelectorLoading(false);
        showErrorBanner(period, err);
      });
  }

  // ── Format helpers ───────────────────────────────────────────────────
  function _fmtInt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(Number(n)).toLocaleString('es-MX');
  }
  function _fmtCurrency(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(Number(n)).toLocaleString('es-MX');
  }
  function _fmtFloat1(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(1);
  }
  function _fmtPct(decimal) {
    if (decimal == null || isNaN(decimal)) return '—';
    return Math.round(Number(decimal) * 100) + '%';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Nombres de mes computados de period.from del payload (la verdad del dato),
  // NUNCA hardcodeados ni de new Date() a secas (hora local del cliente).
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // El T12:00:00 evita el off-by-one de timezone (ISO a medianoche se parsea
  // UTC y cae en el día anterior en CST).
  function _mesDe(iso) {
    if (!iso) return '';
    var d = new Date(String(iso) + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return MESES[d.getMonth()];
  }
  function _mesAnteriorDe(iso) {
    if (!iso) return '';
    var d = new Date(String(iso) + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return MESES[(d.getMonth() + 11) % 12];
  }

  // ── FILA 1 helpers (clone de enpagos-home.js, ajustados) ─────────────

  // Status simple 2-estados (al ritmo / bajo meta) — usado para
  // Captaciones y Citas (más=mejor).
  function _ritmoStatus(actual, expected) {
    if (actual == null || isNaN(actual)) return '';
    if (expected == null || isNaN(expected) || expected <= 0) return '';
    return (Number(actual) >= Number(expected)) ? 'green' : 'red';
  }

  // Status Inversión (3 estados): >+5% sobre-plan rojo, <-20% subgasto amarillo, en banda verde.
  function _inversionPlanStatus(actual, expected) {
    if (actual == null || isNaN(actual)) return '';
    if (expected == null || isNaN(expected) || expected <= 0) return '';
    var ratio = Number(actual) / Number(expected);
    if (ratio > 1.05) return 'red';
    if (ratio < 0.80) return 'yellow';
    return 'green';
  }

  // PROVISIONAL umbrales relativos — pend. validación Anwar (S91, 24-jun).
  // Semáforo 3 estados Citas vs goal prorrateado: ≥0.95 verde, ≥0.80 ámbar, sino rojo.
  function _citasMesStatus(actual, expected) {
    if (actual == null || isNaN(actual)) return '';
    if (expected == null || isNaN(expected) || Number(expected) <= 0) return '';
    var ratio = Number(actual) / Number(expected);
    if (ratio >= 0.95) return 'green';
    if (ratio >= 0.80) return 'yellow';
    return 'red';
  }

  function _chipLabel(status, kind) {
    // kind: 'captac' | 'inversion' | 'citas'
    if (kind === 'captac') {
      if (status === 'green') return 'AL RITMO';
      if (status === 'red')   return 'BAJO META';
      return '';
    }
    if (kind === 'citas') {
      if (status === 'green')  return 'AL RITMO';
      if (status === 'yellow') return 'CERCA DE META';
      if (status === 'red')    return 'BAJO META';
      return '';
    }
    if (kind === 'inversion') {
      if (status === 'green')  return 'EN PLAN';
      if (status === 'yellow') return 'BAJO PLAN';
      if (status === 'red')    return 'SOBREPLAN';
      return '';
    }
    return '';
  }

  function _row1ProgressBarHTML(opts) {
    var fill = opts.fillPct == null || isNaN(opts.fillPct) ? 0 : Number(opts.fillPct);
    var fillPx = Math.max(0, Math.min(100, fill * 100));
    var exp = opts.expectedPct == null || isNaN(opts.expectedPct) ? null : Number(opts.expectedPct);
    var expPx = exp == null ? null : Math.max(0, Math.min(100, exp * 100));
    var cls = 'row1-bar';
    if (opts.graceful) cls += ' row1-bar--graceful';
    var fillCls = 'row1-bar__fill';
    if (opts.status) fillCls += ' row1-bar__fill--' + opts.status;
    var marker = (expPx != null)
      ? '<div class="row1-bar__marker" style="left:' + expPx.toFixed(1) + '%" title="Esperado a la fecha"></div>'
      : '';
    return (
      '<div class="' + cls + '" role="progressbar" aria-valuenow="' + fillPx.toFixed(1) + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="' + fillCls + '" style="width:' + fillPx.toFixed(1) + '%"></div>' +
        marker +
      '</div>'
    );
  }

  function _row1ChipHTML(status, label) {
    if (!status || !label) return '';
    return '<span class="row1-chip row1-chip--' + status + '">' + escapeHtml(label) + '</span>';
  }

  // Funnel % strip — 4 tramos (mensajes → llamadas → citas → captac → cierres).
  // Sub-strip dentro de #goals-section, debajo de row1-grid. SPEC sec 22.1
  // ("% conversión del funnel"). Si una key viene null/ausente, omite ESE
  // tramo (no lo pinta 0% ni NaN), nunca todo el funnel. citas_asistidas
  // queda fuera (Vambe sin stage "visita realizada", muerto).
  function _funnelStripHTML(current) {
    if (!current) return '';
    var steps = [
      { key: 'mensajes',           label: 'Mensajes' },
      { key: 'llamadas_agendadas', label: 'Llamadas' },
      { key: 'citas_agendadas',    label: 'Citas' },
      { key: 'captaciones',        label: 'Captaciones' },
      { key: 'cierres',            label: 'Cierres' }
    ];
    // Solo render si al menos 2 etapas tienen valor numérico — sin eso no hay tramo.
    var presentCount = 0;
    for (var i = 0; i < steps.length; i++) {
      var v = current[steps[i].key];
      if (v != null && !isNaN(v)) presentCount++;
    }
    if (presentCount < 2) return '';
    var parts = [];
    var rendered = 0;
    for (var j = 0; j < steps.length; j++) {
      var step = steps[j];
      var val  = current[step.key];
      if (val == null || isNaN(val)) continue;
      // Conversión vs etapa previa DISPONIBLE (puede saltear ausentes intermedias).
      var pctHTML = '';
      for (var k = j - 1; k >= 0; k--) {
        var prevVal = current[steps[k].key];
        if (prevVal == null || isNaN(prevVal) || Number(prevVal) <= 0) continue;
        var pct = Math.round((Number(val) / Number(prevVal)) * 100);
        pctHTML = ' <span class="funnel-strip__pct">(' + pct + '%)</span>';
        break;
      }
      var nodeHTML = '<span class="funnel-strip__step">' +
                       '<span class="funnel-strip__label">' + escapeHtml(step.label) + '</span> ' +
                       '<span class="funnel-strip__value">' + _fmtInt(val) + '</span>' +
                       pctHTML +
                     '</span>';
      if (rendered > 0) {
        parts.push('<span class="funnel-strip__arrow" aria-hidden="true">→</span>');
      }
      parts.push(nodeHTML);
      rendered++;
    }
    return '<div class="funnel-strip" role="group" aria-label="Conversión del funnel">' +
             parts.join('') +
           '</div>';
  }

  function _row1BoxHTML(opts) {
    var cls = 'row1-box';
    if (opts.gracefulCls) cls += ' ' + opts.gracefulCls;
    var tooltipAttr = opts.tooltip ? ' title="' + escapeHtml(opts.tooltip) + '"' : '';
    var meta = '';
    if (opts.expectedHTML || opts.topeHTML) {
      meta =
        '<div class="row1-box__meta">' +
          (opts.expectedHTML ? '<span class="row1-box__expected">' + opts.expectedHTML + '</span>' : '') +
          (opts.topeHTML ? '<span class="row1-box__tope">' + opts.topeHTML + '</span>' : '') +
        '</div>';
    }
    return (
      '<div class="' + cls + '"' + tooltipAttr + '>' +
        '<div class="row1-box__head">' +
          '<span class="row1-box__label">' + escapeHtml(opts.label) + '</span>' +
          (opts.chipHTML || '') +
        '</div>' +
        '<div class="row1-box__big">' + opts.bigHTML + '</div>' +
        (opts.barHTML || '') +
        meta +
        (opts.subHTML ? '<div class="row1-box__foot">' + opts.subHTML + '</div>' : '') +
      '</div>'
    );
  }

  // ── FILA 1: 4 heros (Captac, Inversión, Citas, Venta) ────────────────
  function renderGoals(data, period) {
    var sec = document.getElementById('goals-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') { sec.innerHTML = ''; return; }

    var current   = (data.totals && data.totals.current) || {};
    var prorrated = data.goals_prorrated                  || {};
    var goals     = data.goals                            || {};
    var isMtd     = (period === 'mtd');

    // ── Captaciones del mes ──
    // §22 2026-06-23: hero = Leadtime FB (Jenny CRM = source de verdad).
    // Sub-bloque "control de fuentes" SIEMPRE VISIBLE — transparencia
    // growth-partner total, sin modo oculto. Decisión cerrada Anwar.
    var captacVal    = current.captaciones;
    var captacGoalMo = goals.captaciones_meta;
    var captacGoalP  = prorrated.captaciones_goal_periodo;
    // 3 fuentes paralelas de "real propiedad captada":
    //   Leadtime = Leadtime CRM rows con fecha de captación  ← OFICIAL (gobierna hero+CAC)
    //   Vambe    = stage "Promoción para venta" first-entry paid
    //   Diario   = sheet "Análisis Mensual 2026 2.0" R23 manual del cliente
    // Avalúo se quitó (es etapa intermedia, no captación consumada).
    var captacSrcDiario    = current.captac_source_diario;
    var captacSrcVambeProm = current.captac_source_vambe_promocion;
    var captacSrcLeadtime  = current.captac_source_leadtime;
    function _captacControlSub() {
      // S91 degradación B_lite: en last_month las 3 fuentes vienen ausentes —
      // render explícito "no disp. mes cerrado" en gris en vez de silencio.
      if (!isMtd) {
        return '<span class="row1-box__foot-graceful">fuentes: no disp. mes cerrado</span>';
      }
      if (captacSrcLeadtime == null && captacSrcVambeProm == null && captacSrcDiario == null) return '';
      // Orden: oficial primero, luego Vambe, luego Diario.
      var parts = [];
      if (captacSrcLeadtime  != null) parts.push('Leadtime ' + _fmtInt(captacSrcLeadtime) + ' (oficial)');
      if (captacSrcVambeProm != null) parts.push('Vambe ' + _fmtInt(captacSrcVambeProm));
      if (captacSrcDiario    != null) parts.push('Diario ' + _fmtInt(captacSrcDiario));
      var sourcesLine = 'fuentes: ' + parts.join(' · ');
      var narrativaLine = '<div class="row1-box__foot-narrativa">Las diferencias reflejan el avance de registro de captaciones en cada sistema.</div>';
      return sourcesLine + narrativaLine;
    }
    var captacHTML;
    if (isMtd) {
      var captacStatus = _ritmoStatus(captacVal, captacGoalP);
      var captacFill = (captacGoalMo != null && captacGoalMo > 0 && captacVal != null)
        ? (Number(captacVal) / Number(captacGoalMo)) : 0;
      var captacExp  = (captacGoalMo != null && captacGoalMo > 0 && captacGoalP != null)
        ? (Number(captacGoalP) / Number(captacGoalMo)) : null;
      captacHTML = _row1BoxHTML({
        label: 'Captaciones del mes',
        bigHTML: _fmtInt(captacVal),
        chipHTML: _row1ChipHTML(captacStatus, _chipLabel(captacStatus, 'captac')),
        barHTML: _row1ProgressBarHTML({ fillPct: captacFill, expectedPct: captacExp, status: captacStatus }),
        expectedHTML: (captacGoalP != null) ? _fmtFloat1(captacGoalP) + ' esperadas' : '',
        topeHTML: (captacGoalMo != null) ? 'Meta ' + _fmtInt(captacGoalMo) : '',
        subHTML: _captacControlSub()
      });
    } else {
      captacHTML = _row1BoxHTML({
        label: 'Captaciones',
        bigHTML: _fmtInt(captacVal),
        subHTML: _captacControlSub()
      });
    }

    // ── Inversión del mes ──
    var invVal    = current.inversion_meta_ads;
    var invGoalMo = goals.inversion_meta;
    var invGoalP  = prorrated.inversion_planeada_periodo;
    var invDown   = (invVal == null);
    var invHTML;
    if (isMtd) {
      var invStatus = invDown ? '' : _inversionPlanStatus(invVal, invGoalP);
      var invFill   = (invGoalMo != null && invGoalMo > 0 && invVal != null)
        ? (Number(invVal) / Number(invGoalMo)) : 0;
      var invExp    = (invGoalMo != null && invGoalMo > 0 && invGoalP != null)
        ? (Number(invGoalP) / Number(invGoalMo)) : null;
      invHTML = _row1BoxHTML({
        label: 'Inversión del mes',
        bigHTML: invDown ? '—' : _fmtCurrency(invVal),
        chipHTML: _row1ChipHTML(invStatus, _chipLabel(invStatus, 'inversion')),
        barHTML: _row1ProgressBarHTML({
          fillPct: invFill, expectedPct: invExp, status: invStatus, graceful: invDown
        }),
        expectedHTML: (invGoalP != null) ? _fmtCurrency(invGoalP) + ' esperado' : '',
        topeHTML: (invGoalMo != null) ? 'Plan ' + _fmtCurrency(invGoalMo) : '',
        gracefulCls: invDown ? 'row1-box--graceful' : ''
      });
    } else {
      invHTML = _row1BoxHTML({
        label: 'Inversión',
        bigHTML: invDown ? '—' : _fmtCurrency(invVal)
      });
    }

    // ── Citas del mes ──
    // §22 2026-06-23: sub-label expone breakdown del 29 (active 18 / previous 11)
    // + orgánicas detectadas (7). El 29 es la única autoridad del hero (sin
    // contradicciones con CAC-cita que usa el mismo 29 como denominador).
    var citasVal    = current.citas_agendadas;
    var citasGoalMo = goals.citas_meta;
    var citasGoalP  = prorrated.citas_goal_periodo;
    var citasActiveCap = current.citas_paid_active_captac;
    var citasPrevCap   = current.citas_paid_previous_captac;
    var citasOrgDet    = current.citas_organic_detected;
    function _citasSub() {
      var parts = [];
      // S91 degradación B_lite: en last_month el split paid (active/previous)
      // viene ausente — render explícito "no disp." en gris para esa porción.
      // El conteo de orgánicas (citas_organic_detected) SÍ existe en last_month;
      // si está presente sigue mostrándose.
      if (isMtd) {
        if (citasActiveCap != null && citasPrevCap != null) {
          parts.push(_fmtInt(citasActiveCap) + ' de campañas activas · ' +
                     _fmtInt(citasPrevCap) + ' de campañas previas');
        }
      } else {
        parts.push('<span class="row1-box__foot-graceful">split paid: no disp. mes cerrado</span>');
      }
      if (citasOrgDet != null && Number(citasOrgDet) > 0) {
        parts.push('+' + _fmtInt(citasOrgDet) + ' orgánicas/no atribuidas detectadas');
      }
      return parts.join(' · ');
    }
    var citasHTML;
    if (isMtd) {
      var citasStatus = _citasMesStatus(citasVal, citasGoalP);
      var citasFill   = (citasGoalMo != null && citasGoalMo > 0 && citasVal != null)
        ? (Number(citasVal) / Number(citasGoalMo)) : 0;
      var citasExp    = (citasGoalMo != null && citasGoalMo > 0 && citasGoalP != null)
        ? (Number(citasGoalP) / Number(citasGoalMo)) : null;
      citasHTML = _row1BoxHTML({
        label: 'Citas del mes',
        bigHTML: _fmtInt(citasVal),
        chipHTML: _row1ChipHTML(citasStatus, _chipLabel(citasStatus, 'citas')),
        barHTML: _row1ProgressBarHTML({ fillPct: citasFill, expectedPct: citasExp, status: citasStatus }),
        expectedHTML: (citasGoalP != null) ? _fmtFloat1(citasGoalP) + ' esperadas' : '',
        topeHTML: (citasGoalMo != null) ? 'Meta ' + _fmtInt(citasGoalMo) : '',
        subHTML: _citasSub() || 'Asistidas: —'
      });
    } else {
      citasHTML = _row1BoxHTML({
        label: 'Citas',
        bigHTML: _fmtInt(citasVal),
        subHTML: _citasSub() || 'Asistidas: —'
      });
    }

    // ── Venta del mes ──
    // SPEC: barra + marker + esperada-a-la-fecha + sublabel aclaratoria.
    var ventaVal    = current.venta;
    var ventaGoalMo = goals.venta_meta;
    var ventaGoalP  = prorrated.venta_goal_periodo;
    // SPEC 20.2: $0 solo es legítimo si ambas plazas reportan número real;
    // si Gómez o Torreón traen venta null (RESULTADO REAL vacío en el
    // Forecast), el 0 del agregado es incompleto → graceful "—" (mismo
    // patrón que el Tintero).
    var byPlazaV     = data.by_plaza_actuals || {};
    var gomezVenta   = byPlazaV.gomez   ? byPlazaV.gomez.venta   : null;
    var torreonVenta = byPlazaV.torreon ? byPlazaV.torreon.venta : null;
    var ventaDown = (ventaVal == null) ||
      (Number(ventaVal) === 0 && (gomezVenta == null || torreonVenta == null));
    var mesPeriodo = _mesDe(data.meta && data.meta.period && data.meta.period.from);
    var ventaHTML;
    if (isMtd) {
      // Venta NO usa chip (decisión SPEC: ratio venta del mes vs captaciones
      // del mes engañoso porque venta cierra captaciones PREVIAS; el sublabel
      // aclara la causa).
      var ventaFill = (ventaGoalMo != null && ventaGoalMo > 0 && ventaVal != null)
        ? (Number(ventaVal) / Number(ventaGoalMo)) : 0;
      var ventaExp  = (ventaGoalMo != null && ventaGoalMo > 0 && ventaGoalP != null)
        ? (Number(ventaGoalP) / Number(ventaGoalMo)) : null;
      ventaHTML = _row1BoxHTML({
        label: 'Venta del mes',
        bigHTML: ventaDown ? '—' : _fmtCurrency(ventaVal),
        chipHTML: '',
        barHTML: _row1ProgressBarHTML({ fillPct: ventaFill, expectedPct: ventaExp, status: '', graceful: ventaDown }),
        expectedHTML: (ventaGoalP != null) ? _fmtCurrency(ventaGoalP) + ' esperada' : '',
        topeHTML: (ventaGoalMo != null) ? 'Plan ' + _fmtCurrency(ventaGoalMo) : '',
        subHTML: 'cierres-venta del mes, no de las captaciones de ' + (mesPeriodo || 'este mes'),
        gracefulCls: ventaDown ? 'row1-box--graceful' : ''
      });
    } else {
      ventaHTML = _row1BoxHTML({
        label: 'Venta',
        bigHTML: ventaDown ? '—' : _fmtCurrency(ventaVal),
        subHTML: 'cierres-venta del periodo'
      });
    }

    // ── Tintero (5º hero — snapshot, mismo valor en mtd y last_month) ──
    // SPEC sec 22.2: big = fresco_30d (vivas, ≤30d), secundario = total - fresco
    // (incluye viejas-con-rastro + 15 sin-registro punto-ciego pre-webhook).
    // NO publicar bruto: mezclaría observables con punto ciego. Snapshot: el
    // backend produce el mismo valor en ambos periods (estado vivo CRM, no
    // métrica del mes) — NO se condiciona a isMtd.
    var tinteroFresco = current.a_espera_aceptacion_fresco_30d;
    var tinteroTotal  = current.a_espera_aceptacion;
    var tinteroHTML = '';
    if (tinteroFresco != null && tinteroTotal != null) {
      var tinteroViejo = Number(tinteroTotal) - Number(tinteroFresco);
      if (tinteroViejo < 0) tinteroViejo = 0;
      var tinteroSubHTML = (tinteroViejo > 0)
        ? '+ ' + _fmtInt(tinteroViejo) + ' de +1 mes'
        : '';
      tinteroHTML = _row1BoxHTML({
        label: 'Tintero (A espera de aceptación)',
        bigHTML: _fmtInt(tinteroFresco) +
                 '<span class="row1-box__big-aux"> frescas ≤30d</span>',
        subHTML: tinteroSubHTML
      });
    } else {
      tinteroHTML = _row1BoxHTML({
        label: 'Tintero (A espera de aceptación)',
        bigHTML: '—',
        subHTML: '',
        gracefulCls: 'row1-box--graceful'
      });
    }

    sec.innerHTML =
      '<div class="row1-grid" role="group" aria-label="Captaciones, inversión, citas, venta y tintero">' +
        captacHTML + invHTML + citasHTML + ventaHTML + tinteroHTML +
      '</div>' +
      _funnelStripHTML(current);
  }
  window.__renderGoals = renderGoals;

  // ── FILA 2 (Ritmo) + FILA 3 (CAC) ────────────────────────────────────

  function _daysInMonth(yyyymmdd) {
    if (!yyyymmdd) return 30;
    var parts = String(yyyymmdd).split('-');
    if (parts.length !== 3) return 30;
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m)) return 30;
    return new Date(y, m, 0).getDate();
  }

  function _kpiCardHTML(opts) {
    var sub = opts.subHTML ? '<div class="kpi-card__sub">' + opts.subHTML + '</div>' : '';
    var chip = opts.chipHTML ? '<div class="kpi-card__chip-row">' + opts.chipHTML + '</div>' : '';
    return (
      '<div class="kpi-card">' +
        '<div class="kpi-card__label">' + escapeHtml(opts.label) + '</div>' +
        '<div class="kpi-card__big">' + opts.valueHTML + '</div>' +
        sub +
        chip +
      '</div>'
    );
  }

  // Status CAC vs objetivo (Inmobili tiene 1 umbral; sin "límite" → 2 estados).
  function _cacStatusVsObj(actual, objetivo) {
    if (actual == null || isNaN(actual)) return '';
    if (objetivo == null || isNaN(objetivo)) return '';
    return (Number(actual) <= Number(objetivo)) ? 'green' : 'yellow';
  }

  function _cacChipHTML(status, objetivoText) {
    if (!status || !objetivoText) return '';
    var label = (status === 'green') ? 'Bajo objetivo' : 'Sobre objetivo';
    return '<span class="kpi-chip kpi-chip--' + status + '">' +
             escapeHtml(label) + ' (' + objetivoText + ')' +
           '</span>';
  }

  function renderKpiStrip(data, period) {
    var sec = document.getElementById('kpi-strip-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') { sec.innerHTML = ''; return; }

    var current = (data.totals && data.totals.current) || {};
    var goals   = data.goals || {};
    var meta    = data.meta  || {};
    var isMtd   = (period === 'mtd');
    var periodDays = (meta.period && meta.period.days) || 1;
    var totalDays  = _daysInMonth(meta.period && meta.period.to);

    // ── FILA 2: ritmo ──
    var f2Boxes = [];

    // Caja 1 — Citas hoy (placeholder — no hay today_citas en backend).
    f2Boxes.push(_kpiCardHTML({
      label: 'Citas agendadas hoy',
      valueHTML: '<span class="kpi-card__big--muted">—</span>',
      subHTML: 'sin desglose diario todavía'
    }));

    // Caja 2 — Citas avg/día.
    var citasVal = current.citas_agendadas;
    var citasAvg = (citasVal != null && periodDays > 0) ? (Number(citasVal) / periodDays) : null;
    f2Boxes.push(_kpiCardHTML({
      label: 'Citas agendadas · promedio diario',
      valueHTML: citasAvg != null ? citasAvg.toFixed(1) : '—',
      subHTML: 'por día (en el mes)'
    }));

    // Caja 3 — Proy. citas EOM (run-rate calendario, NO piso+ritmo —
    // payload Inmobili no expone projection.business_days_*). Termostato
    // visual usa _citasMesStatus contra goals.citas_meta.
    var citasMeta = goals.citas_meta;
    var citasEom = null;
    if (isMtd && citasVal != null && periodDays > 0 && totalDays > 0) {
      citasEom = Math.round((Number(citasVal) / periodDays) * totalDays);
    }
    var citasEomStatus = _citasMesStatus(citasEom, citasMeta);
    var citasEomChip = citasEomStatus
      ? '<span class="kpi-chip kpi-chip--' + citasEomStatus + '">' +
          escapeHtml(_chipLabel(citasEomStatus, 'citas')) +
        '</span>'
      : '';
    f2Boxes.push(_kpiCardHTML({
      label: 'Citas proyectadas fin de mes',
      valueHTML: citasEom != null ? _fmtInt(citasEom) : '—',
      subHTML: (citasMeta != null) ? 'meta ' + _fmtInt(citasMeta) + ' · si mantiene ritmo' : 'si mantiene ritmo',
      chipHTML: citasEomChip
    }));

    // Caja 4 — Proy. captaciones EOM (run-rate).
    var captacVal = current.captaciones;
    var captacEom = null;
    if (isMtd && captacVal != null && periodDays > 0 && totalDays > 0) {
      captacEom = Math.round((Number(captacVal) / periodDays) * totalDays);
    }
    f2Boxes.push(_kpiCardHTML({
      label: 'Captaciones proyectadas fin de mes',
      valueHTML: captacEom != null ? _fmtInt(captacEom) : '—',
      subHTML: 'si mantiene ritmo'
    }));

    // Caja 5 — Proy. inversión EOM.
    var invVal = current.inversion_meta_ads;
    var invEom = null;
    if (isMtd && invVal != null && periodDays > 0 && totalDays > 0) {
      invEom = (Number(invVal) / periodDays) * totalDays;
    }
    f2Boxes.push(_kpiCardHTML({
      label: 'Inversión proyectada fin de mes',
      valueHTML: invEom != null ? _fmtCurrency(invEom) : '—',
      subHTML: 'si mantiene ritmo'
    }));

    // ── FILA 3: CAC ──
    // §22 2026-06-23: ambos CACs llevan badge "preliminar · <mes> en curso ·
    // ancla <mes anterior> $X" SI estamos en mes en curso (mtd). Backend expone
    // current.cac_captacion_last_month_anchor + current.cac_cita_last_month_anchor.
    // Solo aparece en mtd; en last_month NO (ya es el mes cerrado en sí).
    // Meses computados de period.from → rollover automático al cambiar de mes.
    var f3Boxes = [];

    var mesPeriodo  = _mesDe(meta.period && meta.period.from);
    var mesAnterior = _mesAnteriorDe(meta.period && meta.period.from);

    function _preliminarSubLine(anchorAmt) {
      if (!isMtd) return '';
      var base = 'preliminar · ' + (mesPeriodo || 'mes') + ' en curso';
      if (anchorAmt == null) return base;
      return base + ' · ancla ' + (mesAnterior || 'mes anterior') + ' ' + _fmtCurrency(anchorAmt);
    }

    // CAC Captación = spend_captacion / captac_leadtime (= $73,881 / 14 = $5,277)
    var cacCaptac = current.cac;
    var cacObj    = goals.cac_meta;
    var cacStatus = _cacStatusVsObj(cacCaptac, cacObj);
    var captacObjChip = _cacChipHTML(cacStatus, cacObj != null ? 'obj ' + _fmtCurrency(cacObj) : '');
    var captacPreLine = _preliminarSubLine(current.cac_captacion_last_month_anchor);
    f3Boxes.push(_kpiCardHTML({
      label: 'CAC captación',
      valueHTML: (cacCaptac == null) ? '—' : _fmtCurrency(cacCaptac),
      chipHTML: captacObjChip,
      subHTML: captacPreLine ? ('el que manda · ' + captacPreLine) : 'el que manda'
    }));

    // CAC Cita = spend_captacion ÷ citas_paid_total (= $73,881 / 30 = $2,463).
    // Hero "Citas del mes" sigue siendo la única autoridad — el denominador
    // del CAC usa ese mismo número (no hay 17 vs 29 contradicción).
    var cacCita = current.cac_cita;
    if (cacCita == null && invVal != null && citasVal != null && Number(citasVal) > 0) {
      cacCita = Number(invVal) / Number(citasVal);
    }
    var cacCitaPreLine = _preliminarSubLine(current.cac_cita_last_month_anchor);
    var cacCitaBaseSub = 'inversión de ' + (mesPeriodo || 'este mes') + ' ÷ ' + _fmtInt(citasVal) + ' citas';
    f3Boxes.push(_kpiCardHTML({
      label: 'CAC cita agendada',
      valueHTML: cacCita == null ? '—' : _fmtCurrency(cacCita),
      subHTML: cacCitaPreLine ? (cacCitaBaseSub + ' · ' + cacCitaPreLine) : cacCitaBaseSub
    }));

    sec.innerHTML =
      '<div class="kpi-strip-row">' + f2Boxes.join('') + '</div>' +
      '<div class="kpi-strip-row kpi-strip-row--cac">' + f3Boxes.join('') + '</div>';
  }
  window.__renderKpiStrip = renderKpiStrip;

  // ── PLAZA CARDS — 5 cards en grid 3-col ──────────────────────────────
  //
  // Layout per card:
  //   Header: <h3>Plaza</h3> [badge?]
  //   Body rows: Inversión → Mensajes → Llamadas → Citas → Asistencias ("—")
  //   Footer:    "CAPTACIONES N · CAC $X"   +   "VENTA $"
  //   Note (opt): microcopy bajo footer
  //
  // Variantes:
  //   - Torreón / Gómez: badge "Fase 2", data del KV (split parcial).
  //   - Nuevo León: badge "Próximamente", todo "—", nota "Plaza en arranque".
  //   - Orgánicos: SIN badge, Inversión $0 fijo, demás —, nota "Tráfico no pagado".
  //   - Sin atribución: SIN badge, opacity .65, todo —, nota "Sin actividad atribuible".

  function _plazaRowHTML(label, valueHTML, cpaHTML) {
    var cpaSpan = (cpaHTML != null && cpaHTML !== '')
      ? '<span class="plaza-card__row-cpa">' + cpaHTML + '</span>'
      : '<span class="plaza-card__row-cpa plaza-card__row-cpa--empty" aria-hidden="true"></span>';
    return (
      '<div class="plaza-card__row plaza-card__row--with-cpa">' +
        '<span class="plaza-card__row-label">' + escapeHtml(label) + '</span>' +
        cpaSpan +
        '<span class="plaza-card__row-value">' + valueHTML + '</span>' +
      '</div>'
    );
  }

  function _plazaRowSimpleHTML(label, valueHTML) {
    return (
      '<div class="plaza-card__row plaza-card__row--simple">' +
        '<span class="plaza-card__row-label">' + escapeHtml(label) + '</span>' +
        '<span class="plaza-card__row-value">' + valueHTML + '</span>' +
      '</div>'
    );
  }

  function _plazaFooterHTML(captac, cacText, venta) {
    // SPEC: Footer L1 "CAPTACIONES N · CAC" + Footer L2 "VENTA $".
    // Color neutral (NO inherit del rojo de "Cancelados" de EnPagos).
    return (
      '<div class="plaza-card__footer">' +
        '<span class="plaza-card__footer-label">CAPTACIONES</span>' +
        '<span class="plaza-card__footer-value">' + _fmtInt(captac) + '</span>' +
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

  function _plazaCardHTML(opts) {
    // opts: {plazaLabel, badgeHTML, rowsHTML, footerHTML, noteText, cardClass}
    var cls = 'plaza-card';
    if (opts.cardClass) cls += ' ' + opts.cardClass;
    var note = opts.noteText
      ? '<div class="plaza-card__note">' + escapeHtml(opts.noteText) + '</div>'
      : '';
    return (
      '<div class="' + cls + '" data-plaza="' + escapeHtml(opts.plazaLabel) + '">' +
        '<div class="plaza-card__header">' +
          '<h3 class="plaza-card__title">' + escapeHtml(opts.plazaLabel) + (opts.badgeHTML || '') + '</h3>' +
        '</div>' +
        '<div class="plaza-card__body">' + opts.rowsHTML + opts.footerHTML + '</div>' +
        note +
      '</div>'
    );
  }

  function _renderPlazaFase2(plazaLabel, plazaData) {
    // Torreón/Gómez — datos del KV con caveat Fase 2.
    var d = plazaData || {};
    // Backend HOY solo expone: mensajes, venta, cierres, ticket_promedio, captaciones.
    // Inversión / llamadas / citas / asistencias / cac per plaza NO existen en el split → "—".
    var rows = ''
      + _plazaRowHTML('Inversión',  '—')
      + _plazaRowHTML('Mensajes',   _fmtInt(d.mensajes))
      + _plazaRowHTML('Llamadas',   '—')
      + _plazaRowHTML('Citas',      '—')
      + _plazaRowHTML('Asistencias', '—');
    var footer = _plazaFooterHTML(d.captaciones, '—', d.venta);
    var badge = '<span class="plaza-card__badge plaza-card__badge--fase2">Fase 2</span>';
    return _plazaCardHTML({
      plazaLabel: plazaLabel,
      badgeHTML: badge,
      rowsHTML: rows,
      footerHTML: footer,
      noteText: 'Desglose por plaza incompleto — la atribución de inversión / funnel por plaza llega en Fase 2.'
    });
  }

  function _renderPlazaProximamente(plazaLabel) {
    // Nuevo León — placeholder, todo "—".
    var rows = ''
      + _plazaRowHTML('Inversión',   '—')
      + _plazaRowHTML('Mensajes',    '—')
      + _plazaRowHTML('Llamadas',    '—')
      + _plazaRowHTML('Citas',       '—')
      + _plazaRowHTML('Asistencias', '—');
    var footer = _plazaFooterHTML(null, '—', null);
    var badge = '<span class="plaza-card__badge plaza-card__badge--proximamente">Próximamente</span>';
    return _plazaCardHTML({
      plazaLabel: plazaLabel,
      badgeHTML: badge,
      rowsHTML: rows,
      footerHTML: footer,
      noteText: 'Plaza en arranque — sin datos todavía.'
    });
  }

  function _renderPlazaOrganicos() {
    // Orgánicos — Inversión $0 fijo, demás "—" (backend no expone organic split).
    var rows = ''
      + _plazaRowHTML('Inversión',   _fmtCurrency(0))
      + _plazaRowHTML('Mensajes',    '—')
      + _plazaRowHTML('Llamadas',    '—')
      + _plazaRowHTML('Citas',       '—')
      + _plazaRowHTML('Asistencias', '—');
    var footer = _plazaFooterHTML(null, '—', null);
    return _plazaCardHTML({
      plazaLabel: 'Orgánicos',
      badgeHTML: '',
      rowsHTML: rows,
      footerHTML: footer,
      noteText: 'Tráfico no pagado — data de referencia.'
    });
  }

  function _renderPlazaSinAtribucion() {
    // Sin atribución — atenuada, todo "—".
    var rows = ''
      + _plazaRowHTML('Inversión',   '—')
      + _plazaRowHTML('Mensajes',    '—')
      + _plazaRowHTML('Llamadas',    '—')
      + _plazaRowHTML('Citas',       '—')
      + _plazaRowHTML('Asistencias', '—');
    var footer = _plazaFooterHTML(null, '—', null);
    return _plazaCardHTML({
      plazaLabel: 'Sin atribución',
      badgeHTML: '',
      rowsHTML: rows,
      footerHTML: footer,
      noteText: 'Sin actividad atribuible en el periodo.',
      cardClass: 'plaza-card--atenuada'
    });
  }

  function renderPlazaCards(data) {
    var sec = document.getElementById('plaza-cards-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') { sec.innerHTML = ''; return; }

    var byPlaza = data.by_plaza_actuals || {};
    var torreon = byPlaza.torreon || {};
    var gomez   = byPlaza.gomez   || {};

    var cards = ''
      + _renderPlazaFase2('Torreón', torreon)
      + _renderPlazaFase2('Gómez',   gomez)
      + _renderPlazaProximamente('Nuevo León')
      + _renderPlazaOrganicos()
      + _renderPlazaSinAtribucion();

    sec.innerHTML = '<div class="plaza-cards-grid">' + cards + '</div>';
  }
  window.__renderPlazaCards = renderPlazaCards;

  // ── FEED: Captaciones de hoy ─────────────────────────────────────────
  // Backend HOY no produce array today_captaciones → empty state siempre.
  // Flag: deuda backend conocida, no bug.
  function renderTodayDetailFeed(data) {
    var sec = document.getElementById('today-detail-section');
    if (!sec) return;
    if (!data || typeof data !== 'object') { sec.innerHTML = ''; return; }
    var feed = data.totals && data.totals.today_captaciones;
    if (!Array.isArray(feed) || feed.length === 0) {
      sec.innerHTML =
        '<div class="today-feed today-feed--empty">' +
          '<div class="today-feed__title">Captaciones de hoy</div>' +
          '<div class="today-feed__empty" role="status">' +
            '<div class="today-feed__empty-icon" aria-hidden="true">⏳</div>' +
            '<div class="today-feed__empty-title">Sin captaciones hoy</div>' +
            '<div class="today-feed__empty-msg">Cuando llegue la primera captación del día aparece aquí.</div>' +
          '</div>' +
        '</div>';
      return;
    }
    // Si en el futuro el backend produce el array: replica enpagos pattern.
    var rowsHTML = '';
    for (var i = 0; i < feed.length; i++) {
      var item = feed[i];
      var plaza = (item && item.plaza) != null ? String(item.plaza) : '—';
      var prop  = (item && item.propiedad) != null ? String(item.propiedad) : '—';
      var precio = (item && item.precio != null && !isNaN(item.precio)) ? _fmtCurrency(item.precio) : '—';
      rowsHTML +=
        '<div class="today-feed__row" role="row">' +
          '<div class="today-feed__cell" role="cell" data-label="Plaza">' + escapeHtml(plaza) + '</div>' +
          '<div class="today-feed__cell" role="cell" data-label="Propiedad">' + escapeHtml(prop) + '</div>' +
          '<div class="today-feed__cell" role="cell" data-label="Precio">' + escapeHtml(precio) + '</div>' +
        '</div>';
    }
    sec.innerHTML =
      '<div class="today-feed" role="table" aria-label="Captaciones de hoy">' +
        '<div class="today-feed__title">Captaciones de hoy</div>' +
        '<div class="today-feed__grid">' +
          '<div class="today-feed__header" role="row">' +
            '<div class="today-feed__cell" role="columnheader">Plaza</div>' +
            '<div class="today-feed__cell" role="columnheader">Propiedad</div>' +
            '<div class="today-feed__cell" role="columnheader">Precio</div>' +
          '</div>' +
          rowsHTML +
        '</div>' +
      '</div>';
  }
  window.__renderTodayDetailFeed = renderTodayDetailFeed;

  // ── Skeletons / banner ───────────────────────────────────────────────
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
        currentPeriod = null;
        switchPeriod(period);
      });
    }
  }
  function clearBanner() {
    var container = document.getElementById('banner-container');
    if (container) container.innerHTML = '';
  }

  // ── Init ─────────────────────────────────────────────────────────────
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
