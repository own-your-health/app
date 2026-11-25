import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayShow, MOST_BYTES, paperType, SAY_BYTES } from '../src/paper/kind';
import { cdaPaper, decodeText, hasParts, htmlPaper, type Part } from '../src/paper/markup';
import { rtfText } from '../src/paper/rtf';
import { demoJson, FIXTURES } from './helpers';
import type { MedDocument } from '../src/model/types';

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, 'paper', name)));
const latin = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
const utf16 = (text: string, little: boolean): Uint8Array => Uint8Array.from([...(little ? [0xff, 0xfe] : [0xfe, 0xff]), ...[...text].flatMap((c) => (little ? [c.charCodeAt(0), 0] : [0, c.charCodeAt(0)]))]);

/** Parts as a line of text: each element in brackets. */
const shown = (parts: readonly Part[]): string =>
  parts
    .map((p) => {
      if (typeof p === 'string') return p;
      if ('picture' in p) return `{${p.picture.alt || 'picture'}${p.picture.bytes ? ` ${p.picture.media} ${p.picture.bytes.length}` : ''}}`;
      return `<${p.tag}${p.colspan ? ` c${p.colspan}` : ''}${p.rowspan ? ` r${p.rowspan}` : ''}>${shown(p.children)}</>`;
    })
    .join('');
const html = (src: string): string => shown(htmlPaper(src).parts);

describe('what a paper is', () => {
  it('goes by its first bytes before the type it was filed as', () => {
    const types: [string, Uint8Array, string][] = [
      ['\x89PNG\r\n\x1a\n rest', latin('\x89PNG\r\n\x1a\n rest'), 'image image/png'],
      ['JPEG', latin('\xff\xd8\xff\xe0 rest'), 'image image/jpeg'],
      ['GIF', latin('GIF89a rest'), 'image image/gif'],
      ['GIF, the older', latin('GIF87a rest'), 'image image/gif'],
      ['WebP', latin('RIFF\x01\x02\x03\x04WEBPVP8 '), 'image image/webp'],
      ['RIFF of another kind', latin('RIFF\x01\x02\x03\x04WAVEfmt '), 'other'],
      ['TIFF, little', latin('II*\0 rest'), 'other TIFF picture'],
      ['TIFF, big', latin('MM\0* rest'), 'other TIFF picture'],
      ['HEIC', latin('\0\0\0\x18ftypheic rest'), 'other HEIC picture'],
      ['MP4', latin('\0\0\0\x18ftypisom rest'), 'other'],
      ['Word', latin('PK\x03\x04 rest'), 'other Word or Zip file'],
      ['older Word', latin('\xd0\xcf\x11\xe0 rest'), 'other Word file'],
      ['PDF', latin('%PDF-1.4 rest'), 'pdf'],
      ['PDF after other bytes', latin(`${' '.repeat(1024)}%PDF-1.4`), 'pdf'],
      ['a mark too late for a PDF', latin(`${' '.repeat(1025)}%PDF-1.4`), 'other'],
      ['RTF', latin('{\\rtf1\\ansi'), 'rtf'],
      ['RTF after space', latin(' \n{\\rtf1'), 'rtf'],
      ['HTML', latin('<!DOCTYPE html><html>'), 'html'],
      ['HTML without a doctype', latin('\n<HTML><body>'), 'html'],
      ['HTML after a comment', latin('<!-- a --><body>'), 'html'],
      ['XHTML', latin('<?xml version="1.0"?><!DOCTYPE html><html xmlns="x">'), 'html'],
      ['a clinical document', latin('<?xml version="1.0"?>\n<?xml-stylesheet href="a"?><!-- b -->\n<ClinicalDocument xmlns="urn:hl7-org:v3">'), 'cda'],
      ['one with a prefix', latin('<n1:ClinicalDocument>'), 'cda'],
      ['one with a mark', latin('\xef\xbb\xbf<?xml version="1.0"?><ClinicalDocument>'), 'cda'],
      ['one in UTF-16', utf16('<?xml version="1.0"?><ClinicalDocument>', true), 'cda'],
      ['one in UTF-16, big', utf16('<?xml version="1.0"?><ClinicalDocument>', false), 'cda'],
      ['other XML', latin('<?xml version="1.0"?><note>'), 'xml'],
      ['an element of no known kind', latin('<note>'), 'other'],
      ['nothing', new Uint8Array(0), 'other'],
    ];
    for (const [name, bytes, want] of types) {
      const t = paperType('application/octet-stream', bytes);
      expect([name, [t.kind, t.media ?? t.name].filter(Boolean).join(' ')]).toEqual([name, want]);
    }
    // A portal's own type does not change what the bytes say.
    expect(paperType('text/html', latin('%PDF-1.4')).kind).toBe('pdf');
  });

  it('goes by its type where the bytes do not say', () => {
    const of = (type: string | undefined) => paperType(type, latin('words')).kind;
    expect(['text/html', 'TEXT/HTML; charset=utf-8', 'application/xhtml+xml', 'text/xml', 'application/xml', 'application/hl7-cda+xml', 'text/plain', 'image/png', 'application/pdf', undefined].map(of)).toEqual(['html', 'html', 'html', 'xml', 'xml', 'xml', 'text', 'other', 'other', 'other']);
  });

  it('offers none of a type no browser shows', () => {
    expect(['image/tiff', 'image/heic', 'image/heif', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'audio/mpeg', 'video/mp4', 'IMAGE/TIFF; x=1'].filter(mayShow)).toEqual([]);
    expect(['application/pdf', 'image/png', 'application/octet-stream', 'text/html', 'application/rtf', undefined].every(mayShow)).toBe(true);
    expect([SAY_BYTES, MOST_BYTES]).toEqual([10_485_760, 62_914_560]);
  });

  it('knows every paper of the sample', () => {
    const kinds: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'image', 'image/jpeg': 'image', 'text/html': 'html', 'application/xml': 'cda', 'application/rtf': 'rtf' };
    const seen = new Set<string>();
    for (const name of ['Robin', 'Sam', 'Alex', 'Drew']) {
      for (const d of demoJson<{ documents: MedDocument[] }>(`${name} Example/index.json`).documents) {
        const { kind } = paperType(d.media_type, new Uint8Array(readFileSync(join(FIXTURES, '../../public/demo', d.path))));
        expect([d.path, kind]).toEqual([d.path, kinds[d.media_type]]);
        seen.add(kind);
      }
    }
    expect([...seen].sort()).toEqual(['cda', 'html', 'image', 'pdf', 'rtf']);
  });
});

describe('text in a file', () => {
  it('is read in the encoding its mark, its own words or its bytes say', () => {
    expect(decodeText(latin('\xef\xbb\xbfcaf\xc3\xa9'))).toBe('café');
    expect(decodeText(utf16('a b', true))).toBe('a b');
    expect(decodeText(utf16('a b', false))).toBe('a b');
    expect(decodeText(latin('caf\xc3\xa9'))).toBe('café');
    // Not UTF-8: what it says of itself, else Windows-1252.
    expect(decodeText(latin('caf\xe9 \x80'))).toBe('café €');
    expect(decodeText(latin('<?xml version="1.0" encoding="iso-8859-5"?>\xd1'))).toContain('б');
    expect(decodeText(latin('<meta charset="koi8-r">\xc1'))).toContain('а');
    // A name that is none, or a lie, is Windows-1252.
    expect(decodeText(latin('<meta charset="nonesuch">\xe9'))).toContain('é');
    expect(decodeText(latin('<meta charset="utf-8">\xe9'))).toContain('é');
  });
});

describe('a paper in HTML', () => {
  const paper = htmlPaper(decodeText(read('letter.html')));
  const text = shown(paper.parts);

  it('is its headings, words, lists and tables', () => {
    expect(paper.title).toBe('Care & instructions');
    expect(text.startsWith('<h1>Care instructions</><p>Riley Example, seen 03/04/2026 — temperature 99\u00a0°F.</><p>Drink <strong>plenty</> of <em>water</> & rest.<br></>Call if worse.</>')).toBe(true);
    expect(text).toContain('<ul><li>First</><li>Second the portal (https://portal.example/visit?x=1)</><li>Third</></>');
    expect(text).toContain('<table><caption>Doses</><tr><th c2>Medicine</><td r3>Daily</></><tr><td>Ibuprofen</><td>200 mg</></></>');
    expect(text).toContain('<pre>  kept\n    as is</>');
  });

  it('shows a link as its words and its address, and the address once', () => {
    expect(text).toContain('(212) 555-0100, the desk (desk@example.com), portal.example');
    expect(text).not.toMatch(/javascript|subject=/);
    expect(html('<a href="tel:+442071838750">020 7183 8750</a> <a href="tel:555">us</a> <a href="http://portal.example/a/">PORTAL.example/a</a> <a href="#top">top</a> <a>none</a>')).toBe('020 7183 8750 (+442071838750) us (555) PORTAL.example/a top none');
  });

  it('keeps nothing that would run, load, frame or send, nor what is hidden', () => {
    expect(text).not.toMatch(/alert\('|elsewhere|in a frame|in an object|in a shape|in a template|without scripts|unseen|a comment|background/);
    const tags = new Set<string>();
    const walk = (parts: readonly Part[]): void => {
      for (const p of parts) {
        if (typeof p === 'string' || !('tag' in p)) continue;
        tags.add(p.tag);
        expect(Object.keys(p).filter((k) => !['tag', 'children', 'colspan', 'rowspan'].includes(k))).toEqual([]);
        walk(p.children);
      }
    };
    walk(paper.parts);
    expect([...tags].sort()).toEqual(['br', 'caption', 'div', 'em', 'h1', 'li', 'p', 'pre', 'strong', 'table', 'td', 'th', 'tr', 'ul']);
    // Words that look like markup are words.
    expect(text).toContain('An unclosed <script> is only words: <script>alert(1)</script>');
  });

  it('names a picture that is elsewhere, and takes one that is in the file', () => {
    expect(text).toContain('{Example Clinic}');
    expect(text).toContain('{A drawing image/png 8}');
    expect(text).toContain('{A shape}');
    expect(html('<img src="https://elsewhere.example/a.png">x')).toBe('{picture}x');
    expect(html('<img src="https://elsewhere.example/a.png" alt="">x<img alt="Seal" height="1">')).toBe('x');
    expect(html('<img src="data:image/png;base64,!!" alt="Broken">')).toBe('{Broken}');
  });

  it('shows a form’s fields as they are filled in', () => {
    expect(text).toContain('☑ Yes ○ No typed Two Some <notes>');
    expect(text).not.toMatch(/secret|token|Send/);
    expect(html('<select multiple><option>One</option></select><select><optgroup><option>A<option>B</select><input type=checkbox><input type=radio checked>')).toBe('A☐ ◉');
  });

  it('reads loose markup as a browser does', () => {
    expect(html('<p>a<div>b</div>')).toBe('<p>a</><div>b</>');
    expect(html('<table><tr><td>a<table><tr><td>b</table></td><td>c</table>')).toBe('<table><tr><td>a<table><tr><td>b</></></></><td>c</></></>');
    expect(html('<b>a</i>b</b></p>c')).toBe('<strong>ab</>c');
    expect(html('<td>stray</td><li>item</li>')).toBe('<div>stray</><div>item</>');
    expect(html('<table>words<tr><td>cell</table>')).toBe('<table><tr><td>words</></><tr><td>cell</></></>');
    expect(html('<ul>loose<li>item</ul><dl><dt>a<dd>b</dl>')).toBe('<ul><li>loose</><li>item</></><dl><dt>a</><dd>b</></>');
    expect(html('a < b && c &unknown; &#0; &#x110000; &#150; &copy')).toBe('a < b && c &unknown; � � – ©');
    expect(html('<textarea>a</b>c</textarea><xmp><b>x</xmp><plaintext><b>y')).toBe('a</b>c');
    expect(html('unended <script>alert(1)')).toBe('unended');
    expect(html('<!-- unended')).toBe('');
    expect(html('<a href="x')).toBe('');
    expect(html('<td colspan=0>a<td colspan=999>b<td colspan=1.5>c')).toBe('<div>a</><div>b</><div>c</>');
    expect(html('<table><tr><td colspan=0>a<td colspan=999>b<td rowspan=9999 colspan=1.5>c</table>')).toBe('<table><tr><td>a</><td c100>b</><td r1000>c</></></>');
  });

  it('is cut where it is nested or made beyond any real paper', () => {
    const deep = htmlPaper(`${'<div>'.repeat(5000)}deep`);
    expect(shown(deep.parts)).toContain('deep');
    const depth = (parts: readonly Part[]): number => 1 + Math.max(0, ...parts.map((p) => (typeof p !== 'string' && 'tag' in p ? depth(p.children) : 0)));
    expect(depth(htmlPaper(`${'<blockquote>'.repeat(5000)}deep`).parts)).toBeLessThan(130);
    const many = htmlPaper('<p>a</p>'.repeat(70_000));
    expect(many.parts.length).toBe(60_000);
  });

  it('has nothing to show when it holds no words, pictures or rules', () => {
    expect([hasParts(htmlPaper('<script>x</script><p> </p>').parts), hasParts(htmlPaper('<hr>').parts), hasParts(htmlPaper('<div><p>a').parts), hasParts(htmlPaper('<img alt="a">').parts)]).toEqual([false, true, true, true]);
  });
});

describe('a clinical document', () => {
  it('is its title and each section’s own words, in order', () => {
    const paper = cdaPaper(decodeText(read('summary.xml')));
    expect(paper.title).toBe('Visit summary');
    expect(paper.file).toBeUndefined();
    expect(shown(paper.parts)).toBe(
      '<h2>Medicines</><table><tr><th>Medicine</><th>How</></><tr><td><strong>Ibuprofen</></><td>200 mg & food</></><tr><td c2><em>As needed</></></></>' +
        '<h2>Plan</><div><p>Rest.</><ol><li>Call us (https://portal.example/call)</><li>Return</></><div>An X-ray</>{picture} 5 < 6</><h3>At home</><div><s>Ice</> Heat</>',
    );
  });

  it('that only holds a file is that file', () => {
    const paper = cdaPaper(decodeText(read('held.xml')));
    expect([paper.title, paper.parts, paper.file?.media, new TextDecoder().decode(paper.file?.bytes)]).toEqual(['A scanned letter', [], 'application/pdf', '%PDF-1.4\n% invented\n']);
    const held = (text: string) => cdaPaper(`<ClinicalDocument><component><nonXMLBody>${text}</nonXMLBody></component></ClinicalDocument>`).file;
    expect(new TextDecoder().decode(held('<text>Some &lt;words&gt;</text>')!.bytes)).toBe('Some <words>');
    expect(held('<text>Some</text>')!.media).toBe('text/plain');
    expect(held('<text mediaType="text/html">Some</text>')!.media).toBe('text/html');
    expect([held('<text representation="B64">!!</text>'), held('<text> </text>'), held('')]).toEqual([undefined, undefined, undefined]);
  });

  it('that is none has no parts', () => {
    expect(cdaPaper('<note>a</note>')).toEqual({ parts: [] });
    expect(cdaPaper('<ClinicalDocument/>')).toEqual({ parts: [] });
  });
});

describe('a paper in RTF', () => {
  it('is its words, line by line, without what is not text of it', () => {
    expect(rtfText(read('letter.rtf'))).toEqual({
      text: [
        'Dear Dr. Placeholder,',
        'Riley’s knee is better—walking again.',
        'Seen on 03/04\t2 times',
        'next line',
        'Café, €5, é and –after',
        'При 日',
        'the portal',
        'In a box',
        'Braces { and } and a slash \\ stay.',
        'Name\tDose',
        'Ibuprofen\t200 mg',
        '',
        'Signed',
      ].join('\n'),
      pictures: true,
    });
  });

  it('takes what a word processor may write', () => {
    const of = (body: string) => rtfText(latin(`{\\rtf1\\ansi ${body}}`)).text;
    expect(of('a\\~b\\_c\\-d')).toBe('a\u00a0b‑cd');
    expect(of('one\\\ntwo')).toBe('one\ntwo');
    expect(of('\\u-10179?\\u-8704?')).toBe('😀');
    expect(of("\\uc2\\u233\\'c3\\'a9x")).toBe('éx');
    expect(of('{\\bin3 a}b}c')).toBe('c');
    expect(of('{\\*\\shppict{\\pict 00}}x')).toBe('x');
    expect(of('{\\*\\unknown a}b{\\unknown c}')).toBe('bc');
    expect(of('{\\v a{\\v0 b}c}d')).toBe('bd');
    expect(of('{\\v a\\plain b}')).toBe('b');
    expect(rtfText(latin("{\\rtf1\\mac caf\\'8e}")).text).toBe('café');
    expect(rtfText(latin("{\\rtf1\\ansicpg1251\\'cf}")).text).toBe('П');
    expect(rtfText(latin("{\\rtf1\\ansicpg9999 caf\\'e9}")).text).toBe('café');
    expect(rtfText(latin('{\\rtf1 unended {\\b a')).text).toBe('unended a');
    expect([rtfText(latin('')).text, rtfText(latin('{\\rtf1 a}{b}')).text, rtfText(latin('{\\rtf1 a\\')).text]).toEqual(['', 'a', 'a']);
    expect(rtfText(latin('{\\rtf1 a}')).pictures).toBe(false);
    expect(rtfText(latin('{\\rtf1 {\\object{\\objdata 00}}a}'))).toEqual({ text: 'a', pictures: true });
  });
});
