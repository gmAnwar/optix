/**
 * KPICard — one primary metric with label, optional delta and tier pill.
 *
 * Props:
 *   @param {string}  label
 *   @param {number|string=} value          Raw value (used for title tooltip).
 *   @param {string=} formattedValue        Display string; defaults to String(value) or "—" when value is null/undefined.
 *   @param {{value:number, unit?:string, positiveIsGood?:boolean}=} delta
 *   @param {'green'|'yellow'|'red'|'verde'|'amarillo'|'rojo'=} tier  Adds a TierPill next to label.
 *   @param {string=} hint                  Small caption below the value.
 *
 * Exposes: KPICard.create(container, props), KPICard.html(props).
 */
(function () {
  var RED_TIERS = { red: 1, rojo: 1 };

  function html(props) {
    var formatted = props.formattedValue != null ? props.formattedValue
                   : (props.value == null ? '—' : String(props.value));
    var isCritical = !!(props.tier && RED_TIERS[props.tier]);
    var deltaHtml = '';
    if (props.delta && typeof props.delta.value === 'number') {
      var d = props.delta.value;
      var positiveIsGood = props.delta.positiveIsGood !== false;
      var isGood = positiveIsGood ? d >= 0 : d <= 0;
      var cls;
      if (isCritical) {
        cls = 'orx-kpi__delta--neutral';
      } else {
        cls = d === 0 ? 'orx-kpi__delta--flat' : (isGood ? 'orx-kpi__delta--good' : 'orx-kpi__delta--bad');
      }
      var arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '—');
      deltaHtml = '<span class="orx-kpi__delta ' + cls + '">'
                + arrow + ' ' + escapeHtml(formatDelta(d, props.delta.unit)) + '</span>';
    }
    var pillHtml = props.tier ? (window.TierPill ? window.TierPill.html({ tier: props.tier }) : '') : '';
    var hint = props.hint ? '<div class="orx-kpi__hint">' + escapeHtml(props.hint) + '</div>' : '';
    var titleAttr = props.value != null ? ' title="' + escapeHtml(String(props.value)) + '"' : '';
    var sparkHtml = '';
    if (props.sparkline && Array.isArray(props.sparkline.points) && window.Sparkline) {
      sparkHtml = '<div class="orx-kpi__spark">' + window.Sparkline.html(props.sparkline) + '</div>';
    }
    var wrapperCls = 'orx-kpi' + (isCritical ? ' orx-kpi--critical' : '');

    return ''
      + '<div class="' + wrapperCls + '">'
      +   '<div class="orx-kpi__head">'
      +     '<div class="orx-kpi__label">' + escapeHtml(props.label || '') + '</div>'
      +     pillHtml
      +   '</div>'
      +   '<div class="orx-kpi__valueRow">'
      +     '<div class="orx-kpi__value num"' + titleAttr + '>' + escapeHtml(formatted) + '</div>'
      +     sparkHtml
      +   '</div>'
      +   (deltaHtml || hint
          ? '<div class="orx-kpi__foot">' + deltaHtml + hint + '</div>'
          : '')
      + '</div>';
  }

  function formatDelta(v, unit) {
    var s = (v > 0 ? '+' : '') + v;
    if (unit) s += unit;
    return s;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.KPICard = {
    html: html,
    create: function (container, props) {
      container.insertAdjacentHTML('beforeend', html(props || {}));
      return container.lastElementChild;
    }
  };
})();
