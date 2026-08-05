"""In-page DOM collection for the UI Scanner (§6, §7).

A single ``page.evaluate`` pass per frame walks the document once, keeps only
the elements that matter for test automation and returns their semantic,
accessibility, state, positional and contextual metadata. Doing it in one pass
matters: a per-element round trip through Playwright would make a 250-element
page take minutes instead of seconds.

The script also stamps a temporary ``data-qa-scan-uid`` attribute on every
element it keeps. That attribute is what lets the validator prove a candidate
locator resolves to *that* element rather than a look-alike, and it is removed
from the page again before the scan completes.

Nothing sensitive is read here: password and hidden inputs report their
metadata but never their value, and the Python layer re-checks every string
through :mod:`engine.uiscanner.redaction` before it leaves the engine.
"""

from __future__ import annotations

from typing import Any

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Frame

from engine.uiscanner.redaction import looks_sensitive, safe_value
from engine.uiscanner.types import (
    CANDIDATE_SELECTORS,
    UID_ATTRIBUTE,
)

#: Collector executed inside the page. Pure DOM work — no network, no eval.
COLLECTOR_JS = r"""
(options) => {
  const { uidAttr, uidPrefix, selectors, maxElements, includeHidden } = options;

  const collapse = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const attr = (el, name) => el.getAttribute(name) || '';

  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) === 0) return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rects = el.getClientRects();
    if (!rects.length) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // --- implicit ARIA roles (the subset that matters for locators) ---------
  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (attr(el, 'type') || '').toLowerCase();
    switch (tag) {
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : 'generic';
      case 'article': return 'article';
      case 'aside': return 'complementary';
      case 'button': return 'button';
      case 'datalist': return 'listbox';
      case 'details': return 'group';
      case 'dialog': return 'dialog';
      case 'fieldset': return 'group';
      case 'figure': return 'figure';
      case 'footer': return el.closest('article,aside,main,nav,section') ? 'generic' : 'contentinfo';
      case 'form': return 'form';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'header': return el.closest('article,aside,main,nav,section') ? 'generic' : 'banner';
      case 'hr': return 'separator';
      case 'img': return attr(el, 'alt') === '' && el.hasAttribute('alt') ? 'presentation' : 'img';
      case 'input':
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
        if (type === 'email' || type === 'tel' || type === 'text' || type === 'url' || type === '')
          return el.hasAttribute('list') ? 'combobox' : 'textbox';
        if (type === 'image') return 'button';
        return '';
      case 'li': return 'listitem';
      case 'main': return 'main';
      case 'menu': case 'ol': case 'ul': return 'list';
      case 'nav': return 'navigation';
      case 'option': return 'option';
      case 'output': return 'status';
      case 'progress': return 'progressbar';
      case 'section': return 'region';
      case 'select':
        return el.multiple || Number(attr(el, 'size')) > 1 ? 'listbox' : 'combobox';
      case 'summary': return 'button';
      case 'table': return 'table';
      case 'tbody': case 'tfoot': case 'thead': return 'rowgroup';
      case 'td': return 'cell';
      case 'textarea': return 'textbox';
      case 'th': return el.closest('table') ? 'columnheader' : 'cell';
      case 'tr': return 'row';
      default: return '';
    }
  };

  // --- accessible name (accname subset Playwright agrees with) ------------
  const labelElementsFor = (el) => {
    const out = [];
    if (el.id) {
      const escaped = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
      try {
        out.push(...document.querySelectorAll('label[for="' + escaped + '"]'));
      } catch (_) { /* malformed id — wrapping label still applies */ }
    }
    const wrapping = el.closest('label');
    if (wrapping && !out.includes(wrapping)) out.push(wrapping);
    return out;
  };

  const labelText = (el) =>
    collapse(labelElementsFor(el).map((l) => l.textContent || '').join(' '));

  const referencedText = (el, attribute) => {
    const ids = collapse(attr(el, attribute)).split(' ').filter(Boolean);
    if (!ids.length) return '';
    return collapse(
      ids
        .map((id) => {
          const escaped = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
          try { return document.querySelector('#' + escaped); } catch (_) { return null; }
        })
        .filter(Boolean)
        .map((n) => n.textContent || '')
        .join(' '),
    );
  };

  const contentName = (el, depth) => {
    if (depth > 6) return '';
    const parts = [];
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const text = (node.nodeValue || '').trim();
        if (text) parts.push(text);
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (node.getAttribute('aria-hidden') === 'true') continue;
      const label = collapse(node.getAttribute('aria-label') || '');
      if (label) { parts.push(label); continue; }
      if (node.tagName.toLowerCase() === 'img') {
        const alt = collapse(node.getAttribute('alt') || '');
        if (alt) parts.push(alt);
        continue;
      }
      const nested = contentName(node, depth + 1);
      if (nested) parts.push(nested);
    }
    return collapse(parts.join(' '));
  };

  const accessibleName = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (attr(el, 'type') || '').toLowerCase();

    const byRefs = referencedText(el, 'aria-labelledby');
    if (byRefs) return { name: byRefs, source: 'aria-labelledby' };

    const ariaLabel = collapse(attr(el, 'aria-label'));
    if (ariaLabel) return { name: ariaLabel, source: 'aria-label' };

    if (tag === 'input' && (type === 'button' || type === 'submit' || type === 'reset')) {
      const value = collapse(el.value);
      if (value) return { name: value, source: 'value' };
      return { name: type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '', source: 'default' };
    }
    if (tag === 'input' && type === 'image') {
      const alt = collapse(attr(el, 'alt'));
      if (alt) return { name: alt, source: 'alt' };
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const label = labelText(el);
      if (label) return { name: label, source: 'label' };
      const placeholder = collapse(attr(el, 'placeholder'));
      if (placeholder) return { name: placeholder, source: 'placeholder' };
      const title = collapse(attr(el, 'title'));
      if (title) return { name: title, source: 'title' };
      return { name: '', source: '' };
    }
    if (tag === 'img') {
      const alt = collapse(attr(el, 'alt'));
      if (alt) return { name: alt, source: 'alt' };
    }
    if (tag === 'fieldset') {
      const legend = el.querySelector('legend');
      if (legend) return { name: collapse(legend.textContent), source: 'legend' };
    }
    if (tag === 'table') {
      const caption = el.querySelector('caption');
      if (caption) return { name: collapse(caption.textContent), source: 'caption' };
    }
    if (tag === 'figure') {
      const caption = el.querySelector('figcaption');
      if (caption) return { name: collapse(caption.textContent), source: 'figcaption' };
    }

    const text = contentName(el, 0);
    if (text) return { name: text.slice(0, 200), source: 'content' };

    const title = collapse(attr(el, 'title'));
    if (title) return { name: title, source: 'title' };

    const img = el.querySelector('img[alt]');
    if (img) {
      const alt = collapse(attr(img, 'alt'));
      if (alt) return { name: alt, source: 'alt' };
    }
    return { name: '', source: '' };
  };

  // --- context ------------------------------------------------------------
  const namedScope = (el, selector, role) => {
    const node = el.closest(selector);
    if (!node) return null;
    const { name } = accessibleName(node);
    return { role, name, tag: node.tagName.toLowerCase() };
  };

  const nearestHeading = (el) => {
    let node = el;
    while (node && node !== document.body) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (/^h[1-6]$/i.test(sibling.tagName) || sibling.getAttribute('role') === 'heading') {
          return collapse(sibling.textContent).slice(0, 120);
        }
        const nested = sibling.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
        if (nested) return collapse(nested.textContent).slice(0, 120);
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  };

  const scopesOf = (el) => {
    const candidates = [
      ['[role="dialog"],[role="alertdialog"],dialog', 'dialog'],
      ['[role="tabpanel"]', 'tabpanel'],
      ['[role="row"],tr', 'row'],
      ['[role="listitem"],li', 'listitem'],
      ['[role="region"],section[aria-label],section[aria-labelledby]', 'region'],
      ['[role="navigation"],nav', 'navigation'],
      ['[role="menu"]', 'menu'],
      ['fieldset', 'group'],
      ['form', 'form'],
      ['[role="main"],main', 'main'],
      ['article', 'article'],
      ['table', 'table'],
    ];
    const out = [];
    for (const [selector, role] of candidates) {
      const node = el.closest(selector);
      if (!node || node === el) continue;
      const { name } = accessibleName(node);
      if (!name) continue;
      // How far up the ancestor chain this container sits. Scoping to the
      // NEAREST named container is what disambiguates a row of identical
      // buttons in a table; scoping to an outer region leaves every row
      // matching, which is the difference between a usable locator and a
      // "matched 40 elements" warning.
      let depth = 0;
      let cursor = el;
      while (cursor && cursor !== node && depth < 50) {
        cursor = cursor.parentElement;
        depth += 1;
      }
      // Scoping by the whole concatenated row text is brittle; the first
      // meaningful cell identifies the row and survives column changes.
      let label = '';
      const cell = node.querySelector('[role="cell"], [role="rowheader"], td, th, li > *');
      if (cell) label = contentName(cell, 0).slice(0, 60);
      out.push({
        role,
        name: name.slice(0, 160),
        label,
        tag: node.tagName.toLowerCase(),
        depth,
      });
    }
    out.sort((a, b) => a.depth - b.depth);
    return out;
  };

  // --- collection ---------------------------------------------------------
  const seen = new Set();
  const nodes = [];
  for (const selector of selectors) {
    let found;
    try { found = document.querySelectorAll(selector); } catch (_) { continue; }
    for (const node of found) {
      if (!seen.has(node)) { seen.add(node); nodes.push(node); }
    }
  }
  // Restore document order so element keys stay stable between scans.
  nodes.sort((a, b) => {
    const relation = a.compareDocumentPosition(b);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  // Natively interactive tags stay in scope even when marked decorative.
  const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'option'];
  // Roles that exist to be ignored by assistive technology, and therefore by
  // a test-automation scanner too.
  const decorativeRoles = ['presentation', 'none', 'separator'];

  const elements = [];
  let skippedHidden = 0;
  let skippedDecorative = 0;
  let index = 0;
  for (const el of nodes) {
    if (elements.length >= maxElements) break;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link') continue;

    const explicitRole = collapse(attr(el, 'role')).split(' ')[0] || '';
    // presentation/none is the author declaring an element decorative, and a
    // separator is a divider rule. Such nodes carry no name, text or attribute
    // to key on, so collecting them only produces elements no locator can ever
    // address — and, being identical to each other, they flood the review table
    // with "matched 12 elements" noise (§6).
    if (
      decorativeRoles.includes(explicitRole) &&
      !interactiveTags.includes(tag) &&
      !el.hasAttribute('tabindex')
    ) {
      skippedDecorative += 1;
      continue;
    }

    const visible = isVisible(el);
    if (!visible && !includeHidden) { skippedHidden += 1; continue; }

    index += 1;
    const uid = uidPrefix + '-' + index;
    try { el.setAttribute(uidAttr, uid); } catch (_) { continue; }

    const type = (attr(el, 'type') || '').toLowerCase();
    const { name, source } = accessibleName(el);
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const disabled =
      el.disabled === true ||
      el.hasAttribute('disabled') ||
      el.getAttribute('aria-disabled') === 'true';
    const editable =
      el.isContentEditable === true ||
      ((tag === 'input' || tag === 'textarea') && !el.readOnly && !disabled);

    elements.push({
      uid,
      tagName: tag,
      explicitRole,
      inferredRole: explicitRole || implicitRole(el),
      accessibleName: name,
      accessibleNameSource: source,
      visibleText: collapse(el.textContent).slice(0, 200),
      inputType: type,
      name: attr(el, 'name'),
      id: el.id || '',
      placeholder: attr(el, 'placeholder'),
      title: attr(el, 'title'),
      alt: attr(el, 'alt'),
      href: attr(el, 'href'),
      rawValue: typeof el.value === 'string' ? el.value : '',
      testIds: {
        'data-testid': attr(el, 'data-testid'),
        'data-test': attr(el, 'data-test'),
        'data-cy': attr(el, 'data-cy'),
      },
      classes: (el.className && typeof el.className === 'string'
        ? el.className.split(/\s+/).filter(Boolean)
        : []
      ).slice(0, 20),
      ariaLabel: attr(el, 'aria-label'),
      ariaLabelledBy: attr(el, 'aria-labelledby'),
      ariaDescribedBy: attr(el, 'aria-describedby'),
      ariaDescription: attr(el, 'aria-description') || referencedText(el, 'aria-describedby'),
      states: {
        visible,
        hidden: !visible,
        enabled: !disabled,
        disabled,
        editable,
        readOnly: el.readOnly === true || el.getAttribute('aria-readonly') === 'true',
        required: el.required === true || el.getAttribute('aria-required') === 'true',
        selected:
          el.selected === true || el.getAttribute('aria-selected') === 'true',
        checked:
          el.checked === true || el.getAttribute('aria-checked') === 'true',
        expanded: el.getAttribute('aria-expanded') === 'true',
        clickable:
          ['a', 'button', 'summary', 'option'].includes(tag) ||
          ['button', 'submit', 'reset', 'checkbox', 'radio', 'image'].includes(type) ||
          style.cursor === 'pointer' ||
          el.hasAttribute('onclick'),
        focusable:
          (el.tabIndex >= 0 && !disabled) ||
          ['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag),
      },
      position: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inViewport:
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < (window.innerHeight || 0) &&
          rect.left < (window.innerWidth || 0),
      },
      context: {
        associatedLabel: labelText(el),
        nearestHeading: nearestHeading(el),
        nearbyText: collapse(el.parentElement ? el.parentElement.textContent : '').slice(0, 160),
        siblingText: collapse(
          el.previousElementSibling ? el.previousElementSibling.textContent : '',
        ).slice(0, 80),
        scopes: scopesOf(el),
      },
    });
  }

  return {
    url: document.location ? document.location.href : '',
    title: document.title || '',
    elements,
    totalCandidates: nodes.length,
    skippedHidden,
    skippedDecorative,
  };
}
"""


def clear_uids_js(uid_attribute: str = UID_ATTRIBUTE) -> str:
    """Script that removes the temporary scan attribute from a frame."""
    return (
        "(attrName) => { document.querySelectorAll('[' + attrName + ']')"
        ".forEach((el) => el.removeAttribute(attrName)); }"
    )


def collect_frame(
    frame: Frame,
    *,
    uid_prefix: str,
    max_elements: int,
    include_hidden: bool,
) -> dict[str, Any]:
    """Run the collector in ``frame`` and return sanitised element metadata.

    Raises:
        PlaywrightError: When the frame is detached or cross-origin isolated;
            the caller records a warning and continues with other frames.
    """
    raw = frame.evaluate(
        COLLECTOR_JS,
        {
            "uidAttr": UID_ATTRIBUTE,
            "uidPrefix": uid_prefix,
            "selectors": list(CANDIDATE_SELECTORS),
            "maxElements": max_elements,
            "includeHidden": include_hidden,
        },
    )
    raw["elements"] = [_sanitise_element(el) for el in raw.get("elements", [])]
    return raw


def _sanitise_element(element: dict[str, Any]) -> dict[str, Any]:
    """Drop credential-bearing values before the element leaves the engine."""
    input_type = (element.get("inputType") or "").lower()
    sensitive = input_type in {"password", "hidden"} or looks_sensitive(
        element.get("name"),
        element.get("id"),
        element.get("placeholder"),
        element.get("accessibleName"),
        element.get("ariaLabel"),
        element.get("context", {}).get("associatedLabel"),
    )
    element["sensitive"] = sensitive
    # Only the *value* of a credential field is secret. Its label, placeholder,
    # role and type are exactly what a locator needs, so they are kept (§7).
    element["value"] = safe_value(element.pop("rawValue", ""), sensitive=sensitive)
    element["testIds"] = {
        key: safe_value(value)
        for key, value in (element.get("testIds") or {}).items()
        if value
    }
    for key in (
        "placeholder",
        "title",
        "alt",
        "ariaLabel",
        "ariaDescription",
        "accessibleName",
        "visibleText",
    ):
        # safe_value still masks token-shaped strings wherever they appear, so
        # a page that renders a session id as text cannot leak it through here.
        element[key] = safe_value(element.get(key))
    context = element.get("context") or {}
    for key in ("associatedLabel", "nearestHeading", "nearbyText", "siblingText"):
        context[key] = safe_value(context.get(key))
    element["context"] = context
    return element


def clear_scan_attributes(frame: Frame) -> None:
    """Best-effort removal of the temporary uid attribute from a frame."""
    try:
        frame.evaluate(clear_uids_js(), UID_ATTRIBUTE)
    except PlaywrightError:
        # The frame navigated away or detached — the attribute dies with it.
        return
