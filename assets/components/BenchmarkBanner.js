/**
 * BenchmarkBanner — pinned informational banner with reference metrics.
 * Specialized variant for "semana récord" / historical benchmarks.
 *
 * Props:
 *   @param {string}  label                            Headline text (e.g. "Semana récord 16-22 feb 2026").
 *   @param {Array<{key:string, value:string|number}>=} metrics   Small key-value pairs shown inline.
 *   @param {string=} raw                              When metrics is not available, render this text instead.
 *
 * Exposes: BenchmarkBanner.create(container, props), BenchmarkBanner.html(props).
 */
(function () {
  function html(props) {
    var metricsHtml;
    if (Array.isArray(props.metrics) && props.metrics.length) {
      metricsHtml = '<div class="orx-bench__metrics">' + props.metrics.map(function (m) {
        return '<div class="orx-bench__metric">'
             +   '<span class="orx-bench__metric-val num">' + escapeHtml(String(m.value)) + '</span>'
             +   '<span class="orx-bench__metric-key">' + escapeHtml(m.key) + '</span>'
             + '</div>';
      }).join('') + '</div>';
    } else if (props.raw) {
      metricsHtml = '<div class="orx-bench__raw num">' + escapeHtml(props.raw) + '</div>';
    } else {
      metricsHtml = '';
    }

    return ''
      + '<div class="orx-bench" role="note">'
      +   '<div class="orx-bench__badge">★ Récord</div>'
      +   '<div class="orx-bench__main">'
      +     '<div class="orx-bench__label">' + escapeHtml(props.label || '') + '</div>'
      +     metricsHtml
      +   '</div>'
      + '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.BenchmarkBanner = {
    html: html,
    create: function (container, props) {
      container.insertAdjacentHTML('beforeend', html(props || {}));
      return container.lastElementChild;
    }
  };
})();
