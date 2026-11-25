// A paper in HTML, or a clinical document in XML, as a few plain parts: text,
// headings, lists and tables. The paper is never parsed by the browser: it is
// read here, what is not one of the parts below is left out, and the page is
// built from the parts alone. So nothing in a paper can run, load or link.

/** The parts a paper is shown as. */
export type Tag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'div' | 'ul' | 'ol' | 'li' | 'dl' | 'dt' | 'dd' | 'table' | 'caption' | 'tr' | 'td' | 'th' | 'pre' | 'blockquote' | 'hr' | 'br' | 'strong' | 'em' | 'u' | 's' | 'sub' | 'sup';

export type Part = string | Element | Picture;

export interface Element {
  tag: Tag;
  children: Part[];
  colspan?: number;
  rowspan?: number;
}

/** A picture in the paper itself, or the name of one that is not. */
export interface Picture {
  picture: { alt: string; media?: string; bytes?: Uint8Array };
}

export interface Paper {
  title?: string;
  parts: Part[];
  /** A file the document holds, when that is all it holds. */
  file?: { media: string; bytes: Uint8Array };
}

/** An element as read, before it is made a part. */
interface Node {
  name: string;
  attrs: Map<string, string>;
  children: (Node | string)[];
}

// A paper nested deeper, or of more elements, is cut: no real one is.
const DEEPEST = 120;
const MOST = 60_000;

// ---- Reading ---------------------------------------------------------------

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
/** Elements whose content is text up to their end tag, never elements. */
const RAW = new Set('script style textarea title xmp iframe noembed noframes noscript plaintext'.split(' '));
const CLOSES_P = new Set('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr main menu nav ol p pre search section table ul'.split(' '));
/** A start tag ends these, open since the nearest of the second set. */
const ENDS: Record<string, [string[], string[]]> = {
  li: [['li'], ['ul', 'ol', 'menu', 'dir']],
  dt: [['dt', 'dd'], ['dl']],
  dd: [['dt', 'dd'], ['dl']],
  tr: [['tr', 'td', 'th'], ['table']],
  td: [['td', 'th'], ['tr', 'table']],
  th: [['td', 'th'], ['tr', 'table']],
  tbody: [['tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup'], ['table']],
  thead: [['tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup'], ['table']],
  tfoot: [['tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup'], ['table']],
  option: [['option'], ['select', 'datalist']],
};
/** An end tag closes nothing beyond these. */
const WALLS = new Set(['td', 'th', 'table']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Latin 1, in order from U+00A0, then the others HTML 4 names that papers use.
'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
  .split(' ')
  .forEach((name, i) => (ENTITIES[name] = String.fromCharCode(0xa0 + i)));
for (const [name, char] of Object.entries({
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', euro: '€', trade: '™',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', rArr: '⇒', minus: '−', le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', radic: '√', sum: '∑', loz: '◊', check: '✓', cross: '✗', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
}))
  ENTITIES[name] = char;

/** Code points 128 to 159, which pages mean as Windows-1252 (HTML, "numeric character reference end state"). */
const C1 = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i));

function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#x([0-9a-f]{1,8})|#(\d{1,8})|([a-z][a-z0-9]{1,30}));?/gi, (all, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name]! : all;
    const code = hex ? parseInt(hex, 16) : Number(dec);
    if (code >= 0x80 && code <= 0x9f) return C1[code - 0x80]!;
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

/** The text of a file: by its byte order mark, what it says of itself, or UTF-8 where it is that. */
export function decodeText(bytes: Uint8Array): string {
  const [a, b, c] = bytes;
  const as = (label: string, from = 0) => new TextDecoder(label).decode(bytes.subarray(from));
  if (a === 0xef && b === 0xbb && c === 0xbf) return as('utf-8', 3);
  if (a === 0xff && b === 0xfe) return as('utf-16le', 2);
  if (a === 0xfe && b === 0xff) return as('utf-16be', 2);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 2048));
    const label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w-]+)/i.exec(head)?.[1] ?? /<meta[^>]*\bcharset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
    try {
      return as(label && !/^utf-?8$/i.test(label) ? label : 'windows-1252');
    } catch {
      return as('windows-1252');
    }
  }
}

const TAG = /<(?:(!--)|(!\[CDATA\[)|([!?])|(\/)?([a-z][^\s/>]*))/gi;
const ATTR = /[\s/]*([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/y;

/** Reads markup into elements: HTML's loose rules, or XML's. */
function parse(src: string, xml: boolean): Node {
  const root: Node = { name: '#root', attrs: new Map(), children: [] };
  const open: Node[] = [root];
  let made = 0;
  const text = (t: string) => {
    if (t) open.at(-1)!.children.push(t);
  };
  let i = 0;
  while (i < src.length) {
    TAG.lastIndex = i;
    const m = TAG.exec(src);
    if (!m) {
      text(decode(src.slice(i)));
      break;
    }
    text(decode(src.slice(i, m.index)));
    i = TAG.lastIndex;
    const until = (end: string, from = i): number => {
      const at = src.indexOf(end, from);
      return at < 0 ? src.length : at;
    };
    if (m[1]) i = until('-->') + 3;
    else if (m[2]) {
      const end = until(']]>');
      text(src.slice(i, end));
      i = end + 3;
    } else if (m[3]) i = until('>') + 1;
    else {
      const name = xml ? m[5]!.replace(/^[^:]*:/, '') : m[5]!.toLowerCase();
      if (m[4]) {
        i = until('>') + 1;
        close(open, name, xml);
        continue;
      }
      const attrs = new Map<string, string>();
      for (;;) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(src);
        if (!a) break;
        i = ATTR.lastIndex;
        const key = xml ? a[1]!.replace(/^[^:]*:/, '') : a[1]!.toLowerCase();
        if (!attrs.has(key) && attrs.size < 60) attrs.set(key, decode(a[2] ?? a[3] ?? a[4] ?? ''));
      }
      const end = until('>');
      const selfClosed = xml && /\/\s*$/.test(src.slice(m.index, end));
      i = end + 1;
      if (++made > MOST) break;
      if (!xml) endOpen(open, name);
      const node: Node = { name, attrs, children: [] };
      open.at(-1)!.children.push(node);
      if (selfClosed || (!xml && VOID.has(name))) continue;
      if (!xml && RAW.has(name)) {
        const stop = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
        stop.lastIndex = i;
        const at = name === 'plaintext' ? src.length : (stop.exec(src)?.index ?? src.length);
        const raw = src.slice(i, at);
        if (name === 'textarea' || name === 'title') node.children.push(decode(raw));
        i = at >= src.length ? src.length : until('>', at) + 1;
        continue;
      }
      if (open.length < DEEPEST) open.push(node);
    }
  }
  return root;
}

/** What a start tag closes, where HTML lets an end tag be left out. */
function endOpen(open: Node[], name: string): void {
  if (CLOSES_P.has(name)) closeWithin(open, ['p'], WALLS);
  const ends = ENDS[name];
  if (ends) closeWithin(open, ends[0], new Set(ends[1]));
}

function closeWithin(open: Node[], names: string[], walls: ReadonlySet<string>): void {
  let at = -1;
  for (let i = open.length - 1; i > 0 && !walls.has(open[i]!.name); i--) if (names.includes(open[i]!.name)) at = i;
  if (at > 0) open.length = at;
}

function close(open: Node[], name: string, xml: boolean): void {
  for (let i = open.length - 1; i > 0; i--) {
    if (open[i]!.name === name) {
      open.length = i;
      return;
    }
    if (!xml && WALLS.has(open[i]!.name) && !['table', 'tr', 'tbody', 'thead', 'tfoot'].includes(name)) return;
  }
}

// ---- HTML ------------------------------------------------------------------

/** Elements left out with all they hold. */
const DROPPED = new Set('head button script style title meta link base template noscript iframe frame frameset noframes noembed object embed applet param svg math canvas audio video source track map area datalist dialog xmp plaintext'.split(' '));
const AS: Record<string, Tag> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4', p: 'p', ul: 'ul', menu: 'ul', dir: 'ul', ol: 'ol', li: 'li', dl: 'dl', dt: 'dt', dd: 'dd', table: 'table', caption: 'caption', tr: 'tr', td: 'td', th: 'th', pre: 'pre', listing: 'pre', blockquote: 'blockquote', hr: 'hr', br: 'br',
  b: 'strong', strong: 'strong', i: 'em', em: 'em', cite: 'em', dfn: 'em', var: 'em', u: 'u', ins: 'u', s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup',
};
/** Elements that are a block of their own, with no look of their own here. */
const BLOCKS = new Set('address article aside center details div fieldset figcaption figure footer form header legend main nav search section summary'.split(' '));

const hidden = (n: Node): boolean => n.attrs.has('hidden') || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(n.attrs.get('style') ?? '');

const words = (parts: readonly Part[]): string => parts.map((p) => (typeof p === 'string' ? p : 'tag' in p ? words(p.children) : '')).join('');

function htmlParts(children: readonly (Node | string)[]): Part[] {
  return children.flatMap((c): Part[] => {
    if (typeof c === 'string') return [c];
    if (DROPPED.has(c.name) || hidden(c)) return [];
    switch (c.name) {
      case 'img':
        return picture(c);
      case 'input':
        return field(c);
      case 'select':
        return chosen(c);
      case 'a':
        return anchor(c);
      case 'q':
        return ['“', ...htmlParts(c.children), '”'];
      case 'wbr':
        return [];
    }
    const tag = AS[c.name];
    const inner = htmlParts(c.children);
    if (tag) return [element(tag, inner, c)];
    if (BLOCKS.has(c.name)) return [element('div', inner)];
    return inner;
  });
}

function element(tag: Tag, children: Part[], from?: Node): Element {
  const el: Element = { tag, children };
  if (from && (tag === 'td' || tag === 'th')) {
    const span = (attr: string, most: number) => {
      const n = Number(from.attrs.get(attr));
      return Number.isInteger(n) && n > 1 ? Math.min(n, most) : undefined;
    };
    const [colspan, rowspan] = [span('colspan', 100), span('rowspan', 1000)];
    if (colspan) el.colspan = colspan;
    if (rowspan) el.rowspan = rowspan;
  }
  return el;
}

/** A link's words, and its address after them where the words do not say it. Nothing here opens it. */
function anchor(n: Node): Part[] {
  const inner = htmlParts(n.children);
  const address = (n.attrs.get('href') ?? '').trim();
  const shown = /^https?:\/\//i.test(address) ? address : /^(?:mailto|tel):/i.test(address) ? address.replace(/^\w+:/, '').split('?')[0]! : '';
  if (!shown) return inner;
  // Without what only one of them may have: the scheme, a number's country code, its marks.
  const bare = (t: string) => t.replace(/^(?:https?:\/\/(?:www\.)?|\+1)/i, '').replace(/\/+$/, '').replace(/[\s().-]/g, '').toLowerCase();
  return bare(words(inner)).includes(bare(shown)) ? inner : [...inner, ` (${shown})`];
}

const IMAGES = /^data:(image\/(?:png|jpeg|gif|webp))(?:;[^,]*)?;base64,/i;

function picture(n: Node): Part[] {
  const alt = (n.attrs.get('alt') ?? '').trim();
  const src = (n.attrs.get('src') ?? '').trim();
  const data = IMAGES.exec(src);
  const bytes = data ? base64(src.slice(data[0].length)) : undefined;
  if (data && bytes?.length) return [{ picture: { alt, media: data[1]!.toLowerCase(), bytes } }];
  // A spacer or a counter: no name, or one pixel.
  if (!alt || n.attrs.get('width') === '1' || n.attrs.get('height') === '1') return src && !data && !n.attrs.has('alt') ? [{ picture: { alt: '' } }] : [];
  return [{ picture: { alt } }];
}

/** A form's field as what it holds, as a form filed as a paper is read. */
function field(n: Node): Part[] {
  const value = n.attrs.get('value') ?? '';
  switch ((n.attrs.get('type') ?? 'text').toLowerCase()) {
    case 'checkbox':
      return [n.attrs.has('checked') ? '☑ ' : '☐ '];
    case 'radio':
      return [n.attrs.has('checked') ? '◉ ' : '○ '];
    case 'hidden':
    case 'password':
    case 'image':
    case 'file':
    case 'submit':
    case 'reset':
    case 'button':
      return [];
    default:
      return value ? [value] : [];
  }
}

function chosen(n: Node): Part[] {
  const options: Node[] = [];
  const walk = (x: Node) => {
    for (const c of x.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'option') options.push(c);
      else walk(c);
    }
  };
  walk(n);
  const picked = options.filter((o) => o.attrs.has('selected'));
  const shown = picked.length ? picked : n.attrs.has('multiple') ? [] : options.slice(0, 1);
  return shown.length ? [shown.map((o) => words(htmlParts(o.children)).trim()).join(', ')] : [];
}

/** A paper in HTML. */
export function htmlPaper(src: string): Paper {
  const root = parse(src, false);
  const title = findAll(root, 'title', 1)[0];
  return { ...(title ? { title: collapse(textOf(title)) } : {}), parts: tidy(htmlParts(root.children)) };
}

// ---- Clinical documents (HL7 C-CDA) ----------------------------------------

const CDA: Record<string, Tag> = { paragraph: 'p', item: 'li', table: 'table', caption: 'caption', tr: 'tr', td: 'td', th: 'th', br: 'br', sub: 'sub', sup: 'sup' };

function cdaParts(children: readonly (Node | string)[]): Part[] {
  return children.flatMap((c): Part[] => {
    if (typeof c === 'string') return [c];
    const inner = () => cdaParts(c.children);
    switch (c.name) {
      case 'list':
        return [element(/^ordered$/i.test(c.attrs.get('listType') ?? '') ? 'ol' : 'ul', inner())];
      case 'content': {
        const style = c.attrs.get('styleCode') ?? '';
        if (/\bBold\b/i.test(style)) return [element('strong', inner())];
        if (/\bItalics\b/i.test(style)) return [element('em', inner())];
        if (/\bUnderline\b/i.test(style)) return [element('u', inner())];
        return c.attrs.get('revised') === 'delete' ? [element('s', inner())] : inner();
      }
      case 'linkHtml':
        return anchor({ name: 'a', attrs: c.attrs, children: [words(inner())] });
      case 'renderMultiMedia':
        return [...inner(), { picture: { alt: '' } }];
      case 'footnote':
        return [' [', ...inner(), ']'];
    }
    // A caption is a table's; a list's or a paragraph's is its first line.
    if (c.name === 'caption') return [{ tag: 'caption', children: inner() }];
    const tag = CDA[c.name];
    return tag ? [element(tag, inner(), c)] : inner();
  });
}

const textOf = (n: Node): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The first elements of a name, at any depth. */
function findAll(n: Node, name: string, most = Infinity): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [n];
  while (stack.length && out.length < most) {
    const at = stack.pop()!;
    for (let i = at.children.length - 1; i >= 0; i--) {
      const c = at.children[i]!;
      if (typeof c !== 'string') stack.push(c);
    }
    if (at.name === name) out.push(at);
  }
  return out;
}
const child = (n: Node | undefined, ...names: string[]): Node | undefined =>
  names.reduce<Node | undefined>((at, name) => at?.children.find((c): c is Node => typeof c !== 'string' && c.name === name), n);
const childrenOf = (n: Node | undefined, name: string): Node[] => (n?.children ?? []).filter((c): c is Node => typeof c !== 'string' && c.name === name);

function sections(of: Node | undefined, level: number): Part[] {
  return childrenOf(of, 'component').flatMap((c) =>
    childrenOf(c, 'section').flatMap((s): Part[] => {
      const title = child(s, 'title');
      const heading = title ? collapse(textOf(title)) : '';
      const text = child(s, 'text');
      const own: Part[] = text ? cdaParts(text.children) : [];
      const tag: Tag = level === 0 ? 'h2' : level === 1 ? 'h3' : 'h4';
      const inner = sections(s, level + 1);
      if (!heading && !words(own).trim() && !inner.length) return [];
      return [...(heading ? [element(tag, [heading])] : []), element('div', own), ...inner];
    }),
  );
}

/** A clinical document: its title and each section's own words. */
export function cdaPaper(src: string): Paper {
  const doc = findAll(parse(src, true), 'ClinicalDocument', 1)[0];
  if (!doc) return { parts: [] };
  const title = child(doc, 'title');
  const named = title ? collapse(textOf(title)) : '';
  const body = child(doc, 'component', 'structuredBody');
  const paper: Paper = { ...(named ? { title: named } : {}), parts: tidy(sections(body, 0)) };
  const held = child(doc, 'component', 'nonXMLBody', 'text');
  if (!held) return paper;
  if (/^B64$/i.test(held.attrs.get('representation') ?? '')) {
    const bytes = base64(textOf(held));
    if (bytes?.length) return { ...paper, file: { media: held.attrs.get('mediaType') ?? '', bytes } };
    return paper;
  }
  const media = held.attrs.get('mediaType') ?? 'text/plain';
  const own = textOf(held);
  return own.trim() ? { ...paper, file: { media, bytes: new TextEncoder().encode(own) } } : paper;
}

// ---- Parts -----------------------------------------------------------------

function base64(text: string): Uint8Array | undefined {
  try {
    const raw = atob(text.replace(/\s+/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

const INLINE = new Set<Tag>(['strong', 'em', 'u', 's', 'sub', 'sup', 'br']);
const isBlock = (p: Part): boolean => typeof p !== 'string' && 'tag' in p && !INLINE.has(p.tag);
const isBreak = (p: Part | undefined): boolean => p !== undefined && typeof p !== 'string' && 'tag' in p && p.tag === 'br';

/** What may be where: rows in tables, cells in rows, items in lists. Anything else there is shown after it. */
const WITHIN: Partial<Record<Tag, Tag[]>> = { table: ['tr', 'caption'], tr: ['td', 'th'], ul: ['li'], ol: ['li'], dl: ['dt', 'dd'] };
const NEEDS: Partial<Record<Tag, Tag[]>> = { li: ['ul', 'ol'], dt: ['dl'], dd: ['dl'], tr: ['table'], td: ['tr'], th: ['tr'], caption: ['table'] };

/** The parts as they are shown: whitespace as a page has it, each part where it may be, and no empty ones. */
function tidy(parts: Part[], within?: Tag, pre = false): Part[] {
  const out: Part[] = [];
  const allowed = within ? WITHIN[within] : undefined;
  for (const p of parts) {
    if (typeof p === 'string') {
      const text = pre ? p.replace(/\r\n?/g, '\n') : p.replace(/[\t\n\f\r ]+/g, ' ');
      if (!text || (allowed && !text.trim())) continue;
      const last = out.at(-1);
      if (typeof last === 'string') out[out.length - 1] = pre ? last + text : (last + text).replace(/ {2,}/g, ' ');
      else out.push(text);
      continue;
    }
    if (!('tag' in p)) {
      out.push(p);
      continue;
    }
    // A row group is its rows; a list's stray parts are items of it.
    const needs = NEEDS[p.tag];
    const placed = needs && (!within || !needs.includes(within)) ? 'div' : p.tag;
    const inner = tidy(p.children, placed, pre || placed === 'pre');
    if (placed === 'br' || placed === 'hr') out.push({ ...p, tag: placed, children: [] });
    else if (placed === 'td' || placed === 'th') out.push({ ...p, children: trim(inner, pre) });
    else if (inner.some((x) => typeof x !== 'string' || x.trim())) {
      const el: Element = { tag: placed, children: trim(inner, pre || placed === 'pre') };
      // A block that only holds blocks is those.
      if (placed === 'div' && el.children.every(isBlock) && !allowed) out.push(...el.children);
      else out.push(el);
    }
  }
  return allowed ? out.map((p): Part => (typeof p !== 'string' && 'tag' in p && allowed.includes(p.tag) ? p : within === 'table' ? { tag: 'tr', children: [{ tag: 'td', children: [p] }] } : within === 'tr' ? { tag: 'td', children: [p] } : within === 'dl' ? { tag: 'dd', children: [p] } : { tag: 'li', children: [p] })) : trim(out, pre);
}

/** Without the spaces and breaks at a block's ends, or beside a block within it. */
function trim(parts: Part[], pre: boolean): Part[] {
  if (pre) return parts;
  const out = parts.flatMap((p, i): Part[] => {
    if (typeof p !== 'string') return [p];
    let text = p;
    const [before, after] = [parts[i - 1], parts[i + 1]];
    if (before === undefined || isBlock(before) || isBreak(before)) text = text.replace(/^ +/, '');
    if (after === undefined || isBlock(after)) text = text.replace(/ +$/, '');
    return text ? [text] : [];
  });
  while (isBreak(out[0])) out.shift();
  while (isBreak(out.at(-1))) out.pop();
  return out;
}

/** Whether a paper has anything to show. */
export const hasParts = (parts: readonly Part[]): boolean => parts.some((p) => (typeof p === 'string' ? p.trim() !== '' : 'tag' in p ? p.tag === 'hr' || hasParts(p.children) : true));
