/**
 * Small, XSS-safe DOM helpers. Nothing here uses innerHTML with dynamic data:
 * every string becomes a text node.
 * @module dom
 */

/**
 * Anything `h()` and `append()` accept as a child: nodes, text, numbers, nested
 * arrays, and falsy values (skipped) so that `cond && node` works inline.
 * @typedef {Node | string | number | null | undefined | false | 0 | Child[]} Child
 */

/**
 * Looks up an element by id and fails loudly if the page markup changed.
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} id
 * @returns {T}
 */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} in the page`);
  }
  return /** @type {T} */ (el);
}

/**
 * Typed lookups for the form controls the views use.
 * @param {string} id
 */
export const inputById = (id) => /** @type {HTMLInputElement} */ (byId(id));
/** @param {string} id */
export const selectById = (id) => /** @type {HTMLSelectElement} */ (byId(id));
/** @param {string} id */
export const buttonById = (id) => /** @type {HTMLButtonElement} */ (byId(id));
/** @param {string} id */
export const dialogById = (id) => /** @type {HTMLDialogElement} */ (byId(id));

/**
 * Readable message from anything thrown.
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates an element. The return type follows the tag, so `h('input')` is an
 * HTMLInputElement and needs no cast.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string|number|boolean|undefined>} [attrs]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    setAttribute(el, k, v);
  }
  append(el, children);
  return el;
}

/**
 * Sets one attribute safely: skips empty values and refuses inline event handlers.
 * @param {HTMLElement} el
 * @param {string} key
 * @param {string|number|boolean|null|undefined} value
 */
function setAttribute(el, key, value) {
  if (value === undefined || value === false || value === null) {
    return;
  }
  if (key.startsWith('on')) {
    throw new Error('Use addEventListener instead of inline handlers');
  }
  if (key === 'class') {
    el.className = String(value);
    return;
  }
  el.setAttribute(key, value === true ? '' : String(value));
}

/**
 * Appends children safely.
 * @template {Element | DocumentFragment} P
 * @param {P} parent
 * @param {Child[]} children
 * @returns {P}
 */
export function append(parent, children) {
  const flat = /** @type {any[]} */ (children).flat(Infinity);
  for (const c of flat) {
    if (c === null || c === undefined || c === false || Array.isArray(c)) {
      continue;
    }
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

/**
 * Replaces the children of an element.
 * @param {Element} el
 * @param {...Child} children
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
  /** @type {{type: 'ul', items: Array<Array<{bold: boolean, text: string}>>} | null} */
  let list = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    const content = inline(bullet ? bullet[2] : line.replace(/^#+\s*/, ''));
    if (bullet) {
      if (!list) {
        list = { type: 'ul', items: [] };
        blocks.push(list);
      }
      list.items.push(content);
    } else {
      list = null;
      blocks.push({ type: 'p', items: [content] });
    }
  }
  return blocks;
}

/**
 * Turns **bold** spans in one line of model text into <strong> nodes; everything else stays text.
 * @param {string} s
 */
function inline(s) {
  return s
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => {
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
    if (b.type === 'p') {
      frag.append(h('p', {}, run(b.items[0])));
    } else {
      frag.append(
        h(
          'ul',
          {},
          b.items.map((it) => h('li', {}, run(it))),
        ),
      );
    }
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
  return /** @type {F} */ (
    (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    }
  );
}
