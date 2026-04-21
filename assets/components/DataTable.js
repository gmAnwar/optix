/**
 * DataTable — compact table with sticky header and optional click-to-sort.
 *
 * Props:
 *   @param {Array<{key:string, label:string, align?:'left'|'right'|'center',
 *                  format?:(row:any)=>string, sortKey?:(row:any)=>any,
 *                  className?:(row:any)=>string, cellTitle?:(row:any)=>string}>} columns
 *   @param {Array<object>} rows
 *   @param {boolean=} sortable                 Enables click-to-sort (default: false).
 *   @param {string=} rowClassName              Function name on props.rowClass or pass props.rowClass directly.
 *   @param {(row:any, i:number)=>string=} rowClass  Returns extra class per row.
 *   @param {string=} emptyLabel                Message when rows is empty.
 *
 * Exposes: DataTable.create(container, props).
 */
(function () {
  function render(container, props) {
    var columns = props.columns || [];
    var rows = (props.rows || []).slice();
    var state = { key: null, dir: 1 };

    function draw() {
      var thead = '<thead><tr>' + columns.map(function (c, i) {
        var align = c.align ? ' style="text-align:' + c.align + '"' : '';
        var btn = props.sortable
          ? '<button type="button" class="orx-th__btn" data-col="' + i + '">'
            + escapeHtml(c.label) + sortIndicator(c, state) + '</button>'
          : escapeHtml(c.label);
        return '<th' + align + '>' + btn + '</th>';
      }).join('') + '</tr></thead>';

      var sortedRows = rows;
      if (props.sortable && state.key) {
        var col = columns[state.key];
        var getter = col.sortKey || function (r) { return r[col.key]; };
        sortedRows = rows.slice().sort(function (a, b) {
          var va = getter(a), vb = getter(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * state.dir;
          return String(va).localeCompare(String(vb), 'es', { numeric: true }) * state.dir;
        });
      }

      var tbody;
      if (!sortedRows.length) {
        tbody = '<tbody><tr><td colspan="' + columns.length
              + '" class="orx-dt__empty">' + escapeHtml(props.emptyLabel || 'Sin datos')
              + '</td></tr></tbody>';
      } else {
        tbody = '<tbody>' + sortedRows.map(function (row, i) {
          var rowCls = typeof props.rowClass === 'function' ? props.rowClass(row, i) : '';
          return '<tr' + (rowCls ? ' class="' + escapeHtml(rowCls) + '"' : '') + '>'
               + columns.map(function (c) {
                   var raw = c.format ? c.format(row) : (row[c.key] == null ? '—' : row[c.key]);
                   var align = c.align ? ' style="text-align:' + c.align + '"' : '';
                   var cls = c.className ? ' class="' + escapeHtml(c.className(row)) + '"' : '';
                   var title = c.cellTitle ? ' title="' + escapeHtml(c.cellTitle(row)) + '"' : '';
                   return '<td' + cls + align + title + '>' + escapeHtml(String(raw)) + '</td>';
                 }).join('')
               + '</tr>';
        }).join('') + '</tbody>';
      }

      container.innerHTML = '<div class="orx-dt-wrap"><table class="orx-dt">' + thead + tbody + '</table></div>';

      if (props.sortable) {
        container.querySelectorAll('.orx-th__btn').forEach(function (b) {
          b.addEventListener('click', function () {
            var col = Number(b.getAttribute('data-col'));
            if (state.key === col) state.dir = -state.dir; else { state.key = col; state.dir = 1; }
            draw();
          });
        });
      }
    }

    function sortIndicator(col, state) {
      var idx = columns.indexOf(col);
      if (state.key !== idx) return ' <span class="orx-th__arrow muted">↕</span>';
      return ' <span class="orx-th__arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>';
    }

    draw();
    return container.firstElementChild;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.DataTable = {
    create: function (container, props) { return render(container, props || {}); }
  };
})();
