/**
 * EnPagos Overview — live view wired to GET /client_data_public.
 *
 * Public API:
 *   EnPagosOverview.mount(rootElement)   Renders loading → fetch → success/error.
 *
 * // [S50.5-TEMP] Unauthenticated GET to Worker /client_data_public.
 * //   Endpoint is scope-locked server-side to client=enpagos view=overview,
 * //   so query params cannot widen scope. Defenses: Origin allowlist
 * //   (heuristic, blocks browsers not curl) + Cloudflare zone rate limit.
 * //   Firebase Auth migration (F0AKSTMSKSS) ~05 May 2026 adds ID token
 * //   verification per-request.
 *
 * // [FASE-3B-TODO] The endpoint does not yet return:
 * //   - *_7d_avg fields for KPI deltas (rendered without delta today)
 * //   - expectedProgress / pacing curve per metric (Linear mock in ProgressBar)
 * //   - channel breakdown (rendered as a clearly-watermarked MOCK block)
 * //   - firmas_goal / preaut_positivo_goal (rendered as EmptyState when null)
 */
(function () {
  var ENDPOINT = 'https://optix-proxy.anwarhsg.workers.dev/client_data_public';

  var state = {
    root: null,
    data: null     // cached response — used for both light & dark screenshots
  };

  // ── Formatters ───────────────────────────────────────────────────────
  var fmtMoney  = function (v) { return v == null || isNaN(v) ? '—' : '$' + Math.round(v).toLocaleString('es-MX'); };
  var fmtMoneyK = function (v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 10000)   return '$' + Math.round(v / 1000) + 'K';
    return '$' + Math.round(v).toLocaleString('es-MX');
  };
  var fmtNum    = function (v) { return v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('es-MX'); };
  var fmtNum1   = function (v) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(1); };

  function parsePeriod(period) {
    if (!period) return { year: null, month: null, totalDays: 30 };
    var m = /^(\d{4})-(\d{1,2})$/.exec(period);
    if (!m) return { year: null, month: null, totalDays: 30 };
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    return { year: y, month: mo, totalDays: new Date(y, mo, 0).getDate() };
  }

  function dayOfMonthFromAsOf(asOf) {
    var d = new Date(asOf);
    return isNaN(d.getTime()) ? null : d.getDate();
  }

  // ── Top-level render dispatcher ──────────────────────────────────────
  function mount(root) {
    state.root = root;
    fetchAndRender();
  }

  function fetchAndRender() {
    renderLoading();
    fetch(ENDPOINT)
      .then(function (r) {
        if (!r.ok) return Promise.reject(new Error(String(r.status)));
        return r.json();
      })
      .then(function (data) {
        state.data = data;
        renderSuccess(data);
      })
      .catch(function (err) {
        renderError(err.message || String(err));
      });
  }

  // ── States ───────────────────────────────────────────────────────────
  function renderLoading() {
    var period = '2026-' + String(new Date().getMonth() + 1).padStart(2, '0');
    var now = new Date();
    var totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    var html = ''
      + '<div id="ov-meta"></div>'
      + '<div class="ov-stack">'
      +   '<div id="ov-bench-slot"></div>'
      +   '<div id="ov-banners-slot"></div>'
      +   '<div class="ov-section-slot" id="ov-cierres-slot"></div>'
      +   '<div class="ov-section-slot" id="ov-preaut-slot"></div>'
      +   '<div class="ov-section-slot" id="ov-inversion-slot"></div>'
      +   '<div class="ov-section-slot" id="ov-channel-slot"></div>'
      +   '<div class="ov-section-slot" id="ov-ads-slot"></div>'
      + '</div>';
    state.root.innerHTML = html;

    window.MetaStrip.create(document.getElementById('ov-meta'), {
      client: 'enpagos', view: 'overview',
      period: period,
      dayOfMonth: now.getDate(), totalDaysInMonth: totalDays
    });

    ['ov-cierres-slot','ov-preaut-slot','ov-inversion-slot','ov-channel-slot','ov-ads-slot']
      .forEach(function (id) {
        window.Section.create(document.getElementById(id), {
          title: loadingTitleFor(id), loading: true
        });
      });
  }

  function loadingTitleFor(id) {
    return ({
      'ov-cierres-slot':   'Cierres · cargando',
      'ov-preaut-slot':    'Preautorizados positivos · cargando',
      'ov-inversion-slot': 'Inversión · cargando',
      'ov-channel-slot':   'Por canal · cargando',
      'ov-ads-slot':       'Facebook Ads · cargando'
    })[id] || 'Cargando';
  }

  function renderError(msg) {
    state.root.innerHTML = '<div id="ov-err"></div>';
    window.Banner.create(document.getElementById('ov-err'), {
      variant: 'danger',
      title: 'No se pudo cargar la vista',
      message: 'Error ' + msg + '. Verifica tu conexión.',
      action: { label: 'Reintentar', onClick: fetchAndRender }
    });
  }

  // ── Success render ───────────────────────────────────────────────────
  function renderSuccess(data) {
    renderLoading();  // sets up the slot scaffold
    renderMeta(data);
    renderBenchmark(data);
    renderBanners(data);
    renderCierres(data);
    renderPreaut(data);
    renderInversion(data);
    renderChannelMock(data);
    renderAds(data);
  }

  function renderMeta(data) {
    var slot = document.getElementById('ov-meta');
    slot.innerHTML = '';
    var pMeta = parsePeriod(data.meta && data.meta.period);
    var day   = dayOfMonthFromAsOf(data.meta && data.meta.as_of) || new Date().getDate();
    window.MetaStrip.create(slot, {
      client: data.meta && data.meta.client,
      view:   data.meta && data.meta.view,
      period: data.meta && data.meta.period,
      dayOfMonth: day,
      totalDaysInMonth: pMeta.totalDays,
      plannedBudget: data.sections && data.sections.inversion && data.sections.inversion.planeada,
      cacTarget: data.sections && data.sections.cierres && data.sections.cierres.cac_objetivo
    });
  }

  function renderBenchmark(data) {
    var slot = document.getElementById('ov-bench-slot');
    slot.innerHTML = '';
    var bench = data.benchmark || {};
    var label = 'Semana récord';
    var raw = bench.semana_record;
    if (!raw) return;
    // Endpoint returns a flat string ("16-22 Feb 2026: 31 preaut, 3 cierres, $588 costo/preaut").
    // Try to split into label + metrics. If split fails, fall back to raw text.
    var metrics = null;
    var colon = raw.indexOf(':');
    if (colon > 0) {
      label = 'Semana récord — ' + raw.slice(0, colon).trim();
      var tail = raw.slice(colon + 1).trim();
      var bits = tail.split(',').map(function (s) { return s.trim(); });
      var parsed = bits.map(function (b) {
        var m = /^([\$\d.,]+)\s+(.+)$/.exec(b);
        if (m) return { key: m[2], value: m[1] };
        var m2 = /^(\d+)\s+(.+)$/.exec(b);
        if (m2) return { key: m2[2], value: m2[1] };
        return { key: b, value: '' };
      }).filter(function (p) { return p.value; });
      if (parsed.length) metrics = parsed;
    }

    if (metrics) window.BenchmarkBanner.create(slot, { label: label, metrics: metrics });
    else         window.BenchmarkBanner.create(slot, { label: label, raw: raw });
  }

  function renderBanners(data) {
    var slot = document.getElementById('ov-banners-slot');
    slot.innerHTML = '';
    var dc = (data.meta && data.meta.data_completeness) || {};
    var missing = Array.isArray(dc.missing_days) ? dc.missing_days : [];
    if (missing.length) {
      window.Banner.create(slot, {
        variant: 'warning',
        title: 'Data incompleta',
        message: 'Faltan ' + missing.length + ' día' + (missing.length === 1 ? '' : 's')
               + ' de captura: ' + missing.join(', ') + '. Proyecciones usan los días disponibles.'
      });
    }

    if (data.meta && data.meta.as_of) {
      var age = Date.now() - new Date(data.meta.as_of).getTime();
      if (age > 24 * 3600 * 1000) {
        var asOfDate = new Date(data.meta.as_of).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
        window.Banner.create(slot, {
          variant: 'info',
          title: 'Loop Diario desactualizado',
          message: 'Última actualización: ' + asOfDate + '. Revisar créditos Anthropic.'
        });
      }
    }
  }

  // ── Section: Cierres ────────────────────────────────────────────────
  function renderCierres(data) {
    var c = (data.sections && data.sections.cierres) || {};
    var slot = document.getElementById('ov-cierres-slot');

    var section = document.createElement('div');
    window.Section.create(section, { title: 'Cierres (firmas)' });
    var body = section.querySelector('[data-slot]');

    // Progress / goal
    var prog = document.createElement('div');
    prog.className = 'ov-block';
    if (c.goal == null) {
      window.EmptyState.create(prog, {
        title: 'Meta pendiente',
        message: 'Validar firmas_goal con Kike antes del 30 abr.'
      });
    } else {
      // [FASE-3B-TODO] expectedValue is LINEAR mock (see ProgressBar.js).
      var expected = linearExpected(data, c.goal);
      window.ProgressBar.create(prog, {
        label: 'Cierres vs meta',
        value: c.actual || 0, max: c.goal,
        expectedValue: expected,
        formatValue: fmtNum
      });
    }
    body.appendChild(prog);

    var layout = document.createElement('div');
    layout.className = 'kpi-layout';
    var hero = document.createElement('div');  hero.className = 'kpi-hero';
    var grid = document.createElement('div');  grid.className = 'kpi-grid';
    layout.appendChild(hero); layout.appendChild(grid);
    body.appendChild(layout);

    window.KPICard.create(hero, {
      label: 'CAC actual',
      value: c.cac_current,
      formattedValue: fmtMoney(c.cac_current),
      tier: c.cac_tier,
      hint: 'Objetivo ' + fmtMoney(c.cac_objetivo) + ' · límite ' + fmtMoney(c.cac_limite)
    });
    // [FASE-3B-TODO] KPICard 7d deltas omitted — endpoint lacks *_7d_avg fields.
    window.KPICard.create(grid, { label: 'Cierres EOM', value: c.projected_eom, formattedValue: fmtNum1(c.projected_eom), hint: 'proyección lineal' });
    window.KPICard.create(grid, { label: 'Promedio diario', value: c.daily_avg,  formattedValue: fmtNum1(c.daily_avg) + ' / día' });
    window.KPICard.create(grid, { label: 'Cierres hoy',   value: c.today,      formattedValue: fmtNum(c.today) });
    window.KPICard.create(grid, { label: 'Cierres mes',   value: c.actual,     formattedValue: fmtNum(c.actual) });

    slot.replaceWith(section); section.id = 'ov-cierres-slot';
  }

  // ── Section: Preautorizados ─────────────────────────────────────────
  function renderPreaut(data) {
    var p = (data.sections && data.sections.preaut_positivos) || {};
    var slot = document.getElementById('ov-preaut-slot');
    var section = document.createElement('div');
    window.Section.create(section, { title: 'Preautorizados positivos' });
    var body = section.querySelector('[data-slot]');

    var prog = document.createElement('div'); prog.className = 'ov-block';
    if (p.goal == null) {
      window.EmptyState.create(prog, {
        title: 'Meta pendiente',
        message: 'Validar preaut_positivo_goal con Kike antes del 30 abr.'
      });
    } else {
      var expected = linearExpected(data, p.goal);
      window.ProgressBar.create(prog, {
        label: 'Preauts positivos vs meta',
        value: p.actual || 0, max: p.goal,
        expectedValue: expected, formatValue: fmtNum
      });
    }
    body.appendChild(prog);

    var layout = document.createElement('div'); layout.className = 'kpi-layout';
    var hero = document.createElement('div');   hero.className = 'kpi-hero';
    var grid = document.createElement('div');   grid.className = 'kpi-grid';
    layout.appendChild(hero); layout.appendChild(grid);
    body.appendChild(layout);

    var costHint = p.costo_objetivo != null
      ? ('Objetivo ' + fmtMoney(p.costo_objetivo))
      : 'Objetivo pendiente — Fase 3b';
    window.KPICard.create(hero, {
      label: 'Costo / preaut +',
      value: p.costo_actual,
      formattedValue: fmtMoney(p.costo_actual),
      tier: p.costo_tier,
      hint: costHint
    });
    window.KPICard.create(grid, { label: 'Preauts EOM',    value: p.projected_eom, formattedValue: fmtNum1(p.projected_eom), hint: 'proyección lineal' });
    window.KPICard.create(grid, { label: 'Preauts hoy',    value: p.today,         formattedValue: fmtNum(p.today) });
    window.KPICard.create(grid, { label: 'Promedio diario',value: p.daily_avg,     formattedValue: fmtNum1(p.daily_avg) + ' / día' });
    window.KPICard.create(grid, { label: 'Preauts mes',    value: p.actual,        formattedValue: fmtNum(p.actual) });

    slot.replaceWith(section); section.id = 'ov-preaut-slot';
  }

  // ── Section: Inversión ──────────────────────────────────────────────
  function renderInversion(data) {
    var inv = (data.sections && data.sections.inversion) || {};
    var slot = document.getElementById('ov-inversion-slot');
    var section = document.createElement('div');
    window.Section.create(section, { title: 'Inversión' });
    var body = section.querySelector('[data-slot]');

    var prog = document.createElement('div'); prog.className = 'ov-block';
    if (inv.planeada != null && inv.planeada > 0) {
      var expected = linearExpected(data, inv.planeada);
      window.ProgressBar.create(prog, {
        label: 'Inversión vs planeada',
        value: inv.actual || 0, max: inv.planeada,
        expectedValue: expected, formatValue: fmtMoney
      });
    } else {
      window.EmptyState.create(prog, {
        title: 'Inversión planeada no definida',
        message: 'Configurar sections.inversion.planeada.'
      });
    }
    body.appendChild(prog);

    var layout = document.createElement('div'); layout.className = 'kpi-layout';
    var hero = document.createElement('div');   hero.className = 'kpi-hero';
    var grid = document.createElement('div');   grid.className = 'kpi-grid';
    layout.appendChild(hero); layout.appendChild(grid);
    body.appendChild(layout);

    window.KPICard.create(hero, {
      label: 'Inversión mes',
      value: inv.actual,
      formattedValue: fmtMoneyK(inv.actual),
      hint: 'Planeada ' + fmtMoneyK(inv.planeada)
    });
    window.KPICard.create(grid, { label: 'Proyectada EOM', value: inv.projected_eom, formattedValue: fmtMoneyK(inv.projected_eom), hint: 'proyección lineal' });
    window.KPICard.create(grid, { label: 'Promedio diario',value: inv.daily_avg,     formattedValue: fmtMoney(inv.daily_avg) });
    // [FASE-3B-TODO] If Meta Ads API returns $0 live while actual > 0 = alert.
    window.KPICard.create(grid, { label: 'Inversión hoy',  value: inv.today,         formattedValue: fmtMoney(inv.today) });

    slot.replaceWith(section); section.id = 'ov-inversion-slot';
  }

  // ── Section: Channel breakdown (MOCK) ──────────────────────────────
  // [FASE-3B-TODO] Endpoint does not split by channel. Keeping the watermarked
  // mock until /client_data exposes a `channels` section or a dedicated endpoint.
  function renderChannelMock(data) {
    var slot = document.getElementById('ov-channel-slot');
    var section = document.createElement('div');
    window.Section.create(section, { title: 'Por canal' });
    var body = section.querySelector('[data-slot]');

    body.insertAdjacentHTML('beforeend',
      '<div class="ov-watermark">⚠️ MOCK VISUAL — datos inventados para preview de layout, NO usar para decisiones operativas.</div>'
    );

    var grid = document.createElement('div'); grid.className = 'ov-channel-grid';
    grid.innerHTML = [
      channelCard('Meta',              '2', 'cierres', '$30,755', '$15,377', 'red',     'Rojo'),
      channelCard('Google',            '0', 'cierres', '$0',      '—',       'neutral', 'Sin datos'),
      channelCard('WhatsApp Orgánico', '0', 'cierres', 'Free',    'no CAC',  'neutral', 'Free'),
      channelCard('Referido',          '0', 'cierres', 'Free',    'no CAC',  'neutral', 'Free')
    ].join('');
    body.appendChild(grid);

    slot.replaceWith(section); section.id = 'ov-channel-slot';
  }

  function channelCard(name, val, valLabel, spend, cac, tierKey, tierLabel) {
    var pill = '<span class="orx-pill orx-pill--' + tierKey + '">' + escapeHtml(tierLabel) + '</span>';
    return ''
      + '<div class="ov-channel-card">'
      +   '<div class="ov-channel-card__head">'
      +     '<div class="ov-channel-card__name">' + escapeHtml(name) + '</div>'
      +     pill
      +   '</div>'
      +   '<div class="ov-channel-card__val num">' + escapeHtml(val)
      +     ' <span class="ov-channel-card__val-label">' + escapeHtml(valLabel) + '</span></div>'
      +   '<div class="ov-channel-card__foot">'
      +     '<span class="muted">Spend</span> <span>' + escapeHtml(spend) + '</span>'
      +     '<span class="muted"> · CAC</span> <span>' + escapeHtml(cac) + '</span>'
      +   '</div>'
      + '</div>';
  }

  // ── Section: Facebook Ads breakdown ─────────────────────────────────
  function renderAds(data) {
    var rows = (data.sections && Array.isArray(data.sections.facebook_ads)) ? data.sections.facebook_ads : [];
    var slot = document.getElementById('ov-ads-slot');
    var section = document.createElement('div');
    window.Section.create(section, { title: 'Facebook Ads · desglose' });
    var body = section.querySelector('[data-slot]');

    if (!rows.length) {
      window.EmptyState.create(body, { title: 'Sin datos de ads', message: 'El endpoint no devolvió filas.' });
    } else {
      var container = document.createElement('div'); body.appendChild(container);
      window.DataTable.create(container, {
        sortable: true,
        rowClass: function (r) {
          if (r.cac == null) return '';
          if (r.cac < 2500)  return 'orx-dt__row--green';
          if (r.cac <= 3500) return 'orx-dt__row--yellow';
          return 'orx-dt__row--red';
        },
        columns: [
          { key: 'adset', label: 'Adset', cellTitle: function (r) { return r.adset; } },
          { key: 'ad',    label: 'Ad',    cellTitle: function (r) { return r.ad; } },
          { key: 'cierres',   label: 'Cierres', align: 'right', format: function (r) { return fmtNum(r.cierres); }, sortKey: function (r) { return r.cierres != null ? r.cierres : -1; } },
          { key: 'inversion', label: 'Inversión', align: 'right', format: function (r) { return fmtMoney(r.inversion); }, sortKey: function (r) { return r.inversion != null ? r.inversion : -1; } },
          { key: 'cac',       label: 'CAC', align: 'right', format: function (r) { return fmtMoney(r.cac); }, sortKey: function (r) { return r.cac != null ? r.cac : Number.MAX_SAFE_INTEGER; } },
          { key: 'preaut_positivos', label: 'Preauts +', align: 'right', format: function (r) { return fmtNum(r.preaut_positivos); } },
          { key: 'costo_preaut_positivo', label: 'Costo / preaut +', align: 'right', format: function (r) { return fmtMoney(r.costo_preaut_positivo); }, sortKey: function (r) { return r.costo_preaut_positivo != null ? r.costo_preaut_positivo : Number.MAX_SAFE_INTEGER; } }
        ],
        rows: rows
      });
    }
    slot.replaceWith(section); section.id = 'ov-ads-slot';
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  // [FASE-3B-TODO] linearExpected is a LINEAR mock of pacing. Real curve
  // is non-linear (60%+ of EnPagos month closes in final week). Replace
  // with a server-provided expectedProgress field when Fase 3b ships.
  function linearExpected(data, max) {
    if (!max || max <= 0) return null;
    var dc = (data.meta && data.meta.data_completeness) || {};
    var captured = dc.captured_days || 0;
    var total    = dc.expected_days ? dc.expected_days : parsePeriod(data.meta.period).totalDays;
    if (!total) return null;
    var day = dayOfMonthFromAsOf(data.meta && data.meta.as_of) || captured || 1;
    return Math.round((day / total) * max);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.EnPagosOverview = { mount: mount };
})();
