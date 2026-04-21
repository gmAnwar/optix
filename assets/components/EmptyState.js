/**
 * EmptyState — placeholder for missing data / pending goals.
 *
 * Props:
 *   @param {string=} icon          Single glyph / emoji (defaults to ⏳).
 *   @param {string}  title
 *   @param {string=} message
 *   @param {{label:string, onClick?:()=>void, href?:string}=} action
 *
 * Exposes: EmptyState.create(container, props), EmptyState.html(props).
 */
(function () {
  function html(props) {
    var action = '';
    if (props.action && props.action.label) {
      if (props.action.href) {
        action = '<a class="orx-empty__action" href="' + escapeAttr(props.action.href) + '">'
               + escapeHtml(props.action.label) + '</a>';
      } else {
        action = '<button type="button" class="orx-empty__action" data-empty-action>'
               + escapeHtml(props.action.label) + '</button>';
      }
    }
    var msg = props.message
      ? '<div class="orx-empty__msg">' + escapeHtml(props.message) + '</div>' : '';
    return ''
      + '<div class="orx-empty">'
      +   '<div class="orx-empty__icon" aria-hidden="true">' + escapeHtml(props.icon || '⏳') + '</div>'
      +   '<div class="orx-empty__title">' + escapeHtml(props.title || '') + '</div>'
      +   msg
      +   action
      + '</div>';
  }

  function mount(container, props) {
    container.insertAdjacentHTML('beforeend', html(props));
    var el = container.lastElementChild;
    if (props.action && typeof props.action.onClick === 'function') {
      var btn = el.querySelector('[data-empty-action]');
      if (btn) btn.addEventListener('click', props.action.onClick);
    }
    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  window.EmptyState = { html: html, create: function (c, p) { return mount(c, p || {}); } };
})();
