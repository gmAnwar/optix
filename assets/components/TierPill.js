/**
 * TierPill — small colored pill reflecting semaforo state.
 *
 * Props:
 *   @param {'green'|'yellow'|'red'|'verde'|'amarillo'|'rojo'} tier
 *   @param {string=} label   Defaults to a Spanish label per tier.
 *
 * Exposes: TierPill.create(container, props), TierPill.html(props).
 */
(function () {
  var MAP = {
    green:'green', verde:'green',
    yellow:'yellow', amarillo:'yellow',
    red:'red', rojo:'red'
  };
  var DEFAULT_LABEL = { green:'OK', yellow:'Atención', red:'Crítico' };

  function html(props) {
    var t = MAP[props.tier] || 'neutral';
    var label = props.label != null ? props.label : (DEFAULT_LABEL[t] || '—');
    return '<span class="orx-pill orx-pill--' + t + '">' + escapeHtml(label) + '</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.TierPill = {
    html: html,
    create: function (container, props) {
      container.insertAdjacentHTML('beforeend', html(props || {}));
      return container.lastElementChild;
    }
  };
})();
