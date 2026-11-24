/**
 * Small, XSS-safe DOM helpers. Nothing here uses innerHTML with dynamic data:
 * every string becomes a text node.
 * @module dom
 */

/**
 * Creates an element.
 * @param {string} tag
 * @param {Record<string, string|number|boolean|undefined>} [attrs]
 * @param {...(Node|string|number|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === false || v === null) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on')) throw new Error('Use addEventListener instead of inline handlers');
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/**
 * Appends children safely.
 * @param {Node} parent
 * @param {Array<Node|string|number|null|undefined|false>} children
 */
export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

/**
 * Replaces the children of an element.
 * @param {Element} el
 * @param {...any} children
 */
export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/**
 * Splits model text into paragraphs and bullet lists, with **bold**, as DOM
 * nodes. Pure tokeniser is exported for tests.
 * @param {string} text
 * @returns {Array<{type:'p'|'ul', items:Array<Array<{bold:boolean, text:string}>>}>}
 */
export function tokenizeRichText(text) {
  const blocks = [];
  let list = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    const content = inline(bullet ? bullet[2] : line.replace(/^#+\s*/, ''));
    if (bullet) {
      if (!list) { list = { type: 'ul', items: [] }; blocks.push(list); }
      list.items.push(content);
    } else {
      list = null;
      blocks.push({ type: 'p', items: [content] });
    }
  }
  return blocks;
}

function inline(s) {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    return { bold: Boolean(m), text: m ? m[1] : part };
  });
}

/**
 * Renders tokenised text to a fragment.
 * @param {string} text
 */
export function richText(text) {
  const frag = document.createDocumentFragment();
  const run = (spans) => spans.map((s) => (s.bold ? h('strong', {}, s.text) : s.text));
  for (const b of tokenizeRichText(text)) {
    if (b.type === 'p') frag.append(h('p', {}, run(b.items[0])));
    else frag.append(h('ul', {}, b.items.map((it) => h('li', {}, run(it)))));
  }
  return frag;
}

/**
 * Debounce.
 * @template {(...a:any[])=>void} F
 * @param {F} fn
 * @param {number} ms
 * @returns {F}
 */
export function debounce(fn, ms) {
  let t;
  return /** @type {F} */ ((...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  });
}
