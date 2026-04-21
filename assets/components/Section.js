/**
 * Section — titled wrapper that handles loading / error / content states.
 *
 * Props:
 *   @param {string}  title       Section heading.
 *   @param {boolean} loading     Shows skeleton while true.
 *   @param {string=} error       If set, renders an error state instead of children.
 *   @param {Node|string=} children  DOM node or HTML string rendered inside.
 *
 * Exposes: Section.create(container, props), Section.update(el, props).
 */
(function () {
  function render(props) {
    var html = '<div class="orx-section">'
      + '<header class="orx-section__header"><h2 class="orx-section__title">' + escapeHtml(props.title || '') + '</h2></header>'
      + '<div class="orx-section__body" data-slot>';
    if (props.loading) {
      html += '<div class="orx-section__skeleton"></div>';
    } else if (props.error) {
      html += '<div class="orx-section__error">⚠ ' + escapeHtml(props.error) + '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function mount(container, props) {
    container.innerHTML = render(props);
    var slot = container.querySelector('[data-slot]');
    if (!props.loading && !props.error && props.children) {
      appendContent(slot, props.children);
    }
    return container.firstElementChild;
  }

  function appendContent(slot, children) {
    if (typeof children === 'string') {
      slot.insertAdjacentHTML('beforeend', children);
    } else if (children instanceof Node) {
      slot.appendChild(children);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  window.Section = {
    create: function (container, props) { return mount(container, props || {}); },
    update: function (el, props) {
      var parent = el.parentNode;
      parent.replaceChild(document.createRange().createContextualFragment(render(props || {})).firstElementChild, el);
      var slot = parent.querySelector('[data-slot]');
      if (!props.loading && !props.error && props.children) appendContent(slot, props.children);
      return parent.firstElementChild;
    }
  };
})();
