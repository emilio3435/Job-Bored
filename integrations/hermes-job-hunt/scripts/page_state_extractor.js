/*
 * JHOS Phase 7 — Universal Form Page State Extractor
 * Injected by Playwright. Returns a compact, structured view of visible form
 * elements, labels, buttons, validation errors, and page context.
 */

(function () {
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function attrSelector(tag, attr, value) {
    const selector = tag + '[' + attr + '="' + String(value).replace(/"/g, '\\"') + '"]';
    return document.querySelectorAll(selector).length === 1 ? selector : '';
  }

  function uniqueSelector(el) {
    if (!el || !el.tagName) return '';
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id');
    if (id && document.querySelectorAll('#' + cssEscape(id)).length === 1) return '#' + cssEscape(id);

    for (const attr of ['name', 'data-testid', 'data-test', 'data-qa', 'data-automation-id', 'autocomplete', 'aria-label']) {
      const value = el.getAttribute(attr);
      if (value) {
        const selector = attrSelector(tag, attr, value);
        if (selector) return selector;
      }
    }

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      const nodeTag = node.tagName.toLowerCase();
      let part = nodeTag;
      const nodeId = node.getAttribute('id');
      if (nodeId) {
        part += '#' + cssEscape(nodeId);
        parts.unshift(part);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function textFromLabelFor(el) {
    const id = el.getAttribute('id');
    if (!id) return '';
    const label = document.querySelector('label[for="' + cssEscape(id) + '"]');
    return label ? clean(label.innerText || label.textContent) : '';
  }

  function ariaLabelledByText(el) {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return clean(ids.map(id => {
      const ref = document.getElementById(id);
      return ref ? (ref.innerText || ref.textContent) : '';
    }).join(' '));
  }

  function parentLabelText(el) {
    const label = el.closest('label');
    return label ? clean(label.innerText || label.textContent) : '';
  }

  function nearestContainerLabel(el) {
    const container = el.closest('.field, .form-group, .application-field, [class*="field"], [class*="question"], fieldset, div, li');
    if (!container) return '';
    const label = container.querySelector('label, legend, [class*="label"], [class*="question"]');
    if (label && !el.contains(label)) return clean(label.innerText || label.textContent);
    const ownText = clean(container.innerText || container.textContent);
    if (!ownText) return '';
    const current = clean(el.value || el.getAttribute('placeholder') || '');
    return clean(ownText.replace(current, '')).slice(0, 260);
  }

  function getLabel(el) {
    return clean(
      el.getAttribute('aria-label') ||
      ariaLabelledByText(el) ||
      textFromLabelFor(el) ||
      parentLabelText(el) ||
      nearestContainerLabel(el) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.getAttribute('id') ||
      ''
    );
  }

  function getOptions(el) {
    if (el.tagName.toLowerCase() === 'select') {
      return Array.from(el.querySelectorAll('option')).map(opt => ({
        value: opt.value,
        label: clean(opt.textContent),
        selected: opt.selected,
        disabled: opt.disabled,
      })).filter(opt => opt.label || opt.value);
    }
    const role = el.getAttribute('role');
    if (role === 'combobox' || role === 'listbox') {
      let optionRoot = document;
      const owns = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      if (owns && document.getElementById(owns)) optionRoot = document.getElementById(owns);
      return Array.from(optionRoot.querySelectorAll('[role="option"]')).slice(0, 50).map(opt => ({
        value: opt.getAttribute('data-value') || clean(opt.textContent),
        label: clean(opt.textContent),
        selected: opt.getAttribute('aria-selected') === 'true',
        disabled: opt.getAttribute('aria-disabled') === 'true',
      })).filter(opt => opt.label || opt.value);
    }
    return [];
  }

  function elementKind(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'button' || role === 'button') return 'button';
    if (role === 'combobox' || role === 'listbox') return role;
    if (el.isContentEditable) return 'contenteditable';
    return type || tag;
  }

  function getValue(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked ? 'checked' : '';
    if (tag === 'select') return el.options[el.selectedIndex] ? clean(el.options[el.selectedIndex].textContent) : el.value;
    if (el.isContentEditable) return clean(el.innerText || el.textContent);
    return el.value || el.getAttribute('value') || '';
  }

  function getFiles(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type !== 'file') return [];
    return Array.from(el.files || []).map(f => f.name);
  }

  function isRequired(el) {
    return !!(
      el.required ||
      el.getAttribute('aria-required') === 'true' ||
      /required|\*/i.test(getLabel(el)) ||
      /required/i.test(nearestContainerLabel(el))
    );
  }

  function extractElement(el, index) {
    const rect = el.getBoundingClientRect();
    return {
      index,
      selector: uniqueSelector(el),
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      role: el.getAttribute('role') || '',
      kind: elementKind(el),
      name: el.getAttribute('name') || '',
      id: el.getAttribute('id') || '',
      label: getLabel(el),
      placeholder: el.getAttribute('placeholder') || '',
      value: getValue(el),
      files: getFiles(el),
      required: isRequired(el),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      visible: isVisible(el),
      options: getOptions(el),
      text: clean(el.innerText || el.textContent).slice(0, 300),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }

  function visibleText() {
    return clean(document.body ? document.body.innerText : '').slice(0, 3500);
  }

  function validationErrors() {
    const selectors = ['.error', '.field-error', '.validation-error', '.form-error', '.alert-danger', '[role="alert"]', '[aria-live="assertive"]', '[class*="error"]'];
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .filter(isVisible)
      .map(el => clean(el.innerText || el.textContent))
      .filter(Boolean)
      .slice(0, 25);
  }

  function captchaDetected() {
    const txt = visibleText().toLowerCase();
    return txt.includes('captcha') || !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha');
  }

  window.extractPageState = function extractPageState() {
    const selector = 'input, textarea, select, button, input[type="submit"], input[type="button"], [role="button"], [role="combobox"], [role="listbox"], [contenteditable="true"]';
    const elements = Array.from(document.querySelectorAll(selector))
      .map(extractElement)
      .filter(el => el.visible || ['hidden', 'file'].includes(el.type));

    return {
      url: window.location.href,
      title: document.title,
      text: visibleText(),
      elements,
      validation_errors: validationErrors(),
      captcha_detected: captchaDetected(),
      timestamp: new Date().toISOString(),
    };
  };

  return window.extractPageState();
})();
