/**
 * MetaStrip — top-of-page orientation line: client · view · period · day of
 * month · planned budget · CAC target.
 *
 * Props:
 *   @param {string} client              Key like "enpagos" or display string like "EnPagos".
 *   @param {string} view                Key like "overview" or display string like "Overview".
 *   @param {string} period              "YYYY-MM" (e.g. "2026-04") — rendered as "Abril 2026".
 *   @param {number} dayOfMonth
 *   @param {number} totalDaysInMonth
 *   @param {number=} plannedBudget      Hidden below 1200px viewport (CSS-only).
 *   @param {number=} cacTarget          Hidden below 1200px viewport (CSS-only).
 *
 * Exposes: MetaStrip.create(container, props), MetaStrip.html(props).
 */
(function () {
  var CLIENT_LABELS = { enpagos: 'EnPagos', inmobili: 'Inmobili', tuyo: 'Tuyo Health', 'tuyo-health': 'Tuyo Health' };
  var VIEW_LABELS   = { overview: 'Overview', diario: 'Diario', semanal: 'Semanal', weekly: 'Weekly', daily: 'Daily' };
  var MONTHS_ES     = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  function fmtClient(c) {
    if (!c) return '';
    var key = String(c).toLowerCase();
    return CLIENT_LABELS[key] || c;
  }
  function fmtView(v) {
    if (!v) return '';
    var key = String(v).toLowerCase();
    return VIEW_LABELS[key] || v.charAt(0).toUpperCase() + v.slice(1);
  }
  function fmtPeriod(p) {
    if (!p) return '';
    var m = /^(\d{4})-(\d{1,2})$/.exec(String(p));
    if (!m) return p;
    var year = m[1];
    var mo   = parseInt(m[2], 10) - 1;
    if (mo < 0 || mo > 11) return p;
    var name = MONTHS_ES[mo];
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + year;
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('es-MX');
  }

  function html(props) {
    var client = fmtClient(props.client);
    var view   = fmtView(props.view);
    var period = fmtPeriod(props.period);
    var day    = props.dayOfMonth;
    var total  = props.totalDaysInMonth;
    var tooltipBits = [];
    if (props.plannedBudget != null) tooltipBits.push(fmtMoney(props.plannedBudget) + ' planeado');
    if (props.cacTarget != null)     tooltipBits.push('CAC objetivo ' + fmtMoney(props.cacTarget));
    var tooltip = tooltipBits.length ? tooltipBits.join(' · ') : '';

    var parts = [];
    if (client) parts.push('<span class="orx-meta__item orx-meta__client">' + escapeHtml(client) + '</span>');
    if (view)   parts.push('<span class="orx-meta__item">' + escapeHtml(view) + '</span>');
    if (period) parts.push('<span class="orx-meta__item">' + escapeHtml(period) + '</span>');
    if (day != null && total != null) {
      var titleAttr = tooltip ? ' title="' + escapeHtml(tooltip) + '"' : '';
      parts.push(
        '<span class="orx-meta__item orx-meta__day"' + titleAttr + '>'
        + '<span class="orx-meta__day-long">Día ' + escapeHtml(String(day)) + ' de ' + escapeHtml(String(total)) + '</span>'
        + '<span class="orx-meta__day-short">Día ' + escapeHtml(String(day)) + '/' + escapeHtml(String(total)) + '</span>'
        + '</span>'
      );
    }
    if (props.plannedBudget != null) {
      parts.push('<span class="orx-meta__item orx-meta__wide">'
        + escapeHtml(fmtMoney(props.plannedBudget)) + ' planeado</span>');
    }
    if (props.cacTarget != null) {
      parts.push('<span class="orx-meta__item orx-meta__wide">CAC objetivo '
        + escapeHtml(fmtMoney(props.cacTarget)) + '</span>');
    }

    return '<div class="orx-meta" role="note">' + parts.join('') + '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.MetaStrip = {
    html: html,
    create: function (container, props) {
      container.insertAdjacentHTML('beforeend', html(props || {}));
      return container.lastElementChild;
    }
  };
})();
