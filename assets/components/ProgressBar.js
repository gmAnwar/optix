/**
 * ProgressBar — horizontal bar with tier-colored fill + numeric caption.
 *
 * Props:
 *   @param {number}  value
 *   @param {number}  max
 *   @param {number=} expectedValue       If present, renders a vertical tick at
 *                                        expected/max position and recomputes
 *                                        tier against expectedValue (see below).
 *   @param {'green'|'yellow'|'red'|'verde'|'amarillo'|'rojo'=} tier
 *                                        Ignored when expectedValue is passed
 *                                        (tier is derived). Explicit tier still
 *                                        wins when no expectedValue is given.
 *   @param {string=} label               Shown above the bar.
 *   @param {(v:number)=>string=} formatValue   Formatter for value/max/expected.
 *
 * Exposes: ProgressBar.create(container, props), ProgressBar.html(props).
 */
(function () {
  var TIER_MAP = {
    green:'green', verde:'green',
    yellow:'yellow', amarillo:'yellow',
    red:'red', rojo:'red'
  };

  // [FASE-3B-TODO] expectedValue is LINEAR mock only.
  // Real-world is NOT linear:
  //   - EnPagos: 60%+ of month in last week (comercial)
  //   - Inmobili: lumpy, not uniform
  //   - Investment: rises toward end of month
  // Linear in production = constant false reds = noise-based decisions.
  // Phase 3b must pass expectedValue computed server-side from historical
  // curve or Kike-estimated pacing, not linear.
  // DO NOT remove this comment until Fase 3b replaces the curve logic.
  function deriveTier(value, expectedValue) {
    if (expectedValue == null || expectedValue <= 0) return 'neutral';
    if (value >= expectedValue)          return 'green';
    if (value >= expectedValue * 0.85)   return 'yellow';
    return 'red';
  }

  function html(props) {
    var max = Number(props.max) || 0;
    var value = Number(props.value) || 0;
    var hasExpected = props.expectedValue != null && !isNaN(Number(props.expectedValue));
    var expected = hasExpected ? Number(props.expectedValue) : null;

    var pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    var expectedPct = hasExpected && max > 0
      ? Math.max(0, Math.min(100, (expected / max) * 100))
      : null;

    var tierKey = hasExpected ? deriveTier(value, expected) : (TIER_MAP[props.tier] || 'neutral');
    var fmt = typeof props.formatValue === 'function' ? props.formatValue : String;
    var label = props.label
      ? '<div class="orx-progress__label">' + escapeHtml(props.label) + '</div>'
      : '';

    var tickHtml = expectedPct != null
      ? '<div class="orx-progress__tick" style="left:' + expectedPct.toFixed(1) + '%"'
        + ' aria-hidden="true"></div>'
      : '';

    var expectedLine = hasExpected
      ? '<div class="orx-progress__expected">Esperado hoy: '
        + escapeHtml(fmt(expected)) + '</div>'
      : '';

    return ''
      + '<div class="orx-progress">'
      +   label
      +   '<div class="orx-progress__track" role="progressbar"'
      +     ' aria-valuenow="' + value + '"'
      +     ' aria-valuemin="0"'
      +     ' aria-valuemax="' + max + '">'
      +     '<div class="orx-progress__fill orx-progress__fill--' + tierKey
      +       '" style="width:' + pct.toFixed(1) + '%"></div>'
      +     tickHtml
      +   '</div>'
      +   '<div class="orx-progress__caption num">'
      +     '<span>' + escapeHtml(fmt(value)) + '</span>'
      +     '<span class="muted"> / ' + escapeHtml(fmt(max)) + '</span>'
      +     '<span class="orx-progress__pct"> · ' + pct.toFixed(0) + '%</span>'
      +   '</div>'
      +   expectedLine
      + '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.ProgressBar = {
    html: html,
    create: function (container, props) {
      container.insertAdjacentHTML('beforeend', html(props || {}));
      return container.lastElementChild;
    }
  };
})();
