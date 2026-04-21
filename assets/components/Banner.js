/**
 * Banner — informational strip with variant + optional action.
 *
 * Props:
 *   @param {'info'|'warning'|'danger'|'success'} variant
 *   @param {string=} title
 *   @param {string}  message
 *   @param {{label:string, onClick?:()=>void, href?:string}=} action
 *
 * Exposes: Banner.create(container, props), Banner.html(props).
 */
(function () {
  var ICONS = { info:'ℹ', warning:'⚠', danger:'✕', success:'✓' };

  function html(props) {
    var variant = props.variant || 'info';
    var icon = ICONS[variant] || ICONS.info;
    var title = props.title ? '<div class="orx-banner__title">' + escapeHtml(props.title) + '</div>' : '';
    var action = '';
    if (props.action && props.action.label) {
      if (props.action.href) {
        action = '<a class="orx-banner__action" href="' + escapeAttr(props.action.href) + '">'
               + escapeHtml(props.action.label) + '</a>';
      } else {
        action = '<button type="button" class="orx-banner__action" data-banner-action>'
               + escapeHtml(props.action.label) + '</button>';
      }
    }
    return ''
      + '<div class="orx-banner orx-banner--' + variant + '" role="status">'
      +   '<div class="orx-banner__icon" aria-hidden="true">' + icon + '</div>'
      +   '<div class="orx-banner__body">'
      +     title
      +     '<div class="orx-banner__msg">' + escapeHtml(props.message || '') + '</div>'
      +   '</div>'
      +   action
      + '</div>';
  }

  function mount(container, props) {
    container.insertAdjacentHTML('beforeend', html(props));
    var el = container.lastElementChild;
    if (props.action && typeof props.action.onClick === 'function') {
      var btn = el.querySelector('[data-banner-action]');
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

  window.Banner = { html: html, create: function (c, p) { return mount(c, p || {}); } };
})();
