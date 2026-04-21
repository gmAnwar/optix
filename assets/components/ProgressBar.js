/**
 * ProgressBar — horizontal bar with tier-colored fill + numeric caption.
 *
 * Props:
 *   @param {number}  value
 *   @param {number}  max
 *   @param {'green'|'yellow'|'red'|'verde'|'amarillo'|'rojo'=} tier
 *   @param {string=} label                Shown above the bar.
 *   @param {(v:number)=>string=} formatValue   Formatter for value and max.
 *
 * Exposes: ProgressBar.create(container, props), ProgressBar.html(props).
 */
(function () {
  var TIER_MAP = {
    green:'green', verde:'green',
    yellow:'yellow', amarillo:'yellow',
    red:'red', rojo:'red'
  };

  function html(props) {
    var max = Number(props.max) || 0;
    var value = Number(props.value) || 0;
    var pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    var tierCls = TIER_MAP[props.tier] || 'neutral';
    var fmt = typeof props.formatValue === 'function' ? props.formatValue : String;
    var label = props.label
      ? '<div class="orx-progress__label">' + escapeHtml(props.label) + '</div>'
      : '';

    return ''
      + '<div class="orx-progress">'
      +   label
      +   '<div class="orx-progress__track" role="progressbar"'
      +     ' aria-valuenow="' + value + '"'
      +     ' aria-valuemin="0"'
      +     ' aria-valuemax="' + max + '">'
      +     '<div class="orx-progress__fill orx-progress__fill--' + tierCls
      +       '" style="width:' + pct.toFixed(1) + '%"></div>'
      +   '</div>'
      +   '<div class="orx-progress__caption num">'
      +     '<span>' + escapeHtml(fmt(value)) + '</span>'
      +     '<span class="muted"> / ' + escapeHtml(fmt(max)) + '</span>'
      +     '<span class="orx-progress__pct"> · ' + pct.toFixed(0) + '%</span>'
      +   '</div>'
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
