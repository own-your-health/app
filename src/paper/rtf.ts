// The text of an RTF paper: its words, line by line, and nothing else of it.
// Fonts, colours, pictures, objects and fields' instructions are left out.

/** Groups that hold no text of the paper. */
const LEFT_OUT = new Set(
  (
    'aftncn aftnsep aftnsepc annotation atnauthor atndate atnicn atnid atnparent atnref atntime atrfend atrfstart author bkmkend bkmkstart blipuid buptim category colorschememapping colortbl comment ' +
    'company creatim datafield datastore defchp defpap do docvar dptxbxtext fchars ffdeftext ffentrymcr ffexitmcr ffformat ffhelptext ffl ffname ffstattext file filetbl fldinst fonttbl footer footerf ' +
    'footerl footerr formfield ftncn ftnsep ftnsepc generator gridtbl header headerf headerl headerr hlinkbase info keywords latentstyles lchars levelnumbers leveltext listlevel ' +
    'listname listoverride listoverridetable liststylename listtable mailmerge manager mmathPr nesttableprops nextfile nonesttables objalias objclass objdata object objname objsect objtime oleclsid ' +
    'operator panose password passwordhash pgp pgptbl pict picprop printim private propname protend protstart protusertbl pxe revtbl revtim rsidtbl rxe shpgrp shpinst ' +
    'sn sp staticval stylesheet subject sv tc template themedata title txe ud userprops wgrffmtfilter windowcaption writereservation writereservhash xe xform xmlattrname xmlattrvalue xmlclose xmlname xmlnstbl xmlopen'
  ).split(' '),
);

/** Control words that are a character or a break. */
const CHARACTERS: Record<string, string> = {
  par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', nestrow: '\n', cell: '\t', nestcell: '\t', tab: '\t',
  emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
};

/** The code pages a font's character set names (the RTF specification's \fcharset). */
const CHARSETS: Record<number, number> = { 0: 1252, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };
const LABELS: Record<number, string> = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 65001: 'utf-8' };

function decoder(codePage: number): TextDecoder {
  try {
    return new TextDecoder(LABELS[codePage] ?? `windows-${codePage}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

interface Group {
  /** Nothing in the group is text. */
  out: boolean;
  /** Its text is marked hidden. */
  hidden: boolean;
  /** How many characters stand in for a \u character where it cannot be read. */
  instead: number;
  font: number | undefined;
}

export interface RtfText {
  text: string;
  /** It also holds pictures or objects. */
  pictures: boolean;
}

export function rtfText(bytes: Uint8Array): RtfText {
  const src = new Array<string>();
  let pictures = false;
  let codePage = 1252;
  let deffont: number | undefined;
  /** The code page of each font's characters. */
  const fonts = new Map<number | undefined, number | undefined>();
  const groups: Group[] = [];
  let g: Group = { out: false, hidden: false, instead: 1, font: undefined };
  /** Characters still to leave out after a \u. */
  let skip = 0;
  let starred = false;
  /** Bytes of the code page, kept together: one character may be two of them. */
  let pending: number[] = [];

  const flush = () => {
    if (!pending.length) return;
    src.push(decoder(fonts.get(g.font ?? deffont) ?? codePage).decode(new Uint8Array(pending)));
    pending = [];
  };
  const put = (text: string) => {
    flush();
    if (!g.out && !g.hidden) src.push(text);
  };
  const byte = (b: number) => {
    if (skip > 0) skip--;
    else if (!g.out && !g.hidden) pending.push(b);
  };

  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const c = bytes[i]!;
    if (c === 0x7b) {
      flush();
      groups.push(g);
      g = { ...g };
      skip = 0;
      i++;
    } else if (c === 0x7d) {
      flush();
      g = groups.pop() ?? g;
      skip = 0;
      i++;
      // What follows the last group is not the paper's.
      if (!groups.length) break;
    } else if (c === 0x5c) {
      i++;
      const d = bytes[i];
      if (d === undefined) break;
      if (!isLetter(d)) {
        i++;
        if (d === 0x27) {
          const hex = parseInt(String.fromCharCode(bytes[i] ?? 0, bytes[i + 1] ?? 0), 16);
          i += 2;
          if (Number.isFinite(hex)) byte(hex);
        } else if (d === 0x2a) starred = true;
        else if (d === 0x7e) put(' ');
        else if (d === 0x5f) put('‑');
        else if (d === 0x0a || d === 0x0d) put('\n');
        else if (d === 0x5c || d === 0x7b || d === 0x7d) byte(d);
        continue;
      }
      const from = i;
      while (i < n && isLetter(bytes[i]!)) i++;
      const word = String.fromCharCode(...bytes.subarray(from, Math.min(i, from + 64)));
      const signAt = i;
      if (bytes[i] === 0x2d) i++;
      const digits = i;
      while (i < n && isDigit(bytes[i]!)) i++;
      if (i === digits) i = signAt;
      const value = i > digits ? Number(String.fromCharCode(...bytes.subarray(signAt, Math.min(i, signAt + 12)))) : undefined;
      if (bytes[i] === 0x20) i++;
      const wasStarred = starred;
      starred = false;
      if (word === 'pict' || word === 'object') pictures = true;
      // A text box's words, within a shape that is otherwise left out.
      if (word === 'shptxt') g.out = false;
      else if (LEFT_OUT.has(word) || (wasStarred && word !== 'shppict')) {
        flush();
        g.out = true;
      }
      switch (word) {
        case 'bin':
          i += Math.max(0, value ?? 0);
          break;
        case 'u':
          if (skip > 0) skip--;
          else if (value !== undefined) {
            const code = value < 0 ? value + 0x10000 : value;
            // A pair of surrogates is two of these, joined as the text is.
            if (code >= 0 && code <= 0xffff) put(String.fromCharCode(code));
            skip = g.instead;
          }
          break;
        case 'uc':
          g.instead = Math.max(0, value ?? 1);
          break;
        case 'ansicpg':
          if (value) codePage = value;
          break;
        case 'mac':
          codePage = 10000;
          break;
        case 'pc':
          codePage = 437;
          break;
        case 'pca':
          codePage = 850;
          break;
        case 'deff':
          deffont = value;
          break;
        case 'f':
          flush();
          g.font = value;
          break;
        case 'plain':
          flush();
          g.font = undefined;
          g.hidden = false;
          break;
        case 'fcharset':
          fonts.set(g.font, CHARSETS[value ?? 0]);
          break;
        case 'v':
          flush();
          g.hidden = value !== 0;
          break;
        default:
          if (CHARACTERS[word]) {
            if (skip > 0) skip--;
            else put(CHARACTERS[word]);
          }
      }
    } else {
      i++;
      if (c !== 0x0a && c !== 0x0d) byte(c);
    }
  }
  flush();
  const text = src
    .join('')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, pictures };
}

const isLetter = (b: number): boolean => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
const isDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;
