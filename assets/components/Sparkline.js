/**
 * Sparkline — minimal inline chart as SVG polyline.
 *
 * Props:
 *   @param {number[]} points
 *   @param {string=}  color      CSS color (default: var(--color-accent)).
 *   @param {number=}  width      Pixels (default 80).
 *   @param {number=}  height     Pixels (default 24).
 *   @param {boolean=} showDot    Draws a dot at the last point (default true).
 *
 * Exposes: Sparkline.create(container, props), Sparkline.html(props).
 */
(function () {
  function html(props) {
    var w = props.width || 80;
    var h = props.height || 24;
    var points = (props.points || []).map(Number).filter(function (n) { return !isNaN(n); });
    if (points.length < 2) {
      return '<svg class="orx-spark" width="' + w + '" height="' + h + '" aria-hidden="true">'
           + '<line x1="0" y1="' + (h/2) + '" x2="' + w + '" y2="' + (h/2)
           + '" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.4" /></svg>';
    }

    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var range = max - min || 1;
    var step = w / (points.length - 1);

    var pts = points.map(function (v, i) {
      var x = (i * step).toFixed(2);
      var y = (h - ((v - min) / range) * (h - 2) - 1).toFixed(2);
      return x + ',' + y;
    }).join(' ');

    var color = props.color || 'var(--color-accent)';
    var dot = '';
    if (props.showDot !== false) {
      var last = pts.split(' ').pop().split(',');
      dot = '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2" fill="' + color + '"/>';
    }

    return '<svg class="orx-spark" width="' + w + '" height="' + h
         + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">'
         +   '<polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts + '"/>'
         +   dot
         + '</svg>';
  }

  window.Sparkline = {
    html: html,
    create: function (container, props) {
      container.insertAdjacentHTML('beforeend', html(props || {}));
      return container.lastElementChild;
    }
  };
})();
