// What a paper's file is, by its first bytes, and by the type medrec filed it
// as where the bytes do not say.

export type PaperKind = 'pdf' | 'image' | 'html' | 'cda' | 'xml' | 'rtf' | 'text' | 'other';

export interface PaperType {
  kind: PaperKind;
  /** For a picture: its media type. */
  media?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** For a type no browser here shows: its name, where it has a plain one. */
  name?: string;
}

const ascii = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));

/** The signature of a file, or undefined when its first bytes are no signature here. */
function signature(bytes: Uint8Array): PaperType | undefined {
  const at = (from: number, text: string) => ascii(bytes, from, from + text.length) === text;
  if (at(0, '\x89PNG\r\n\x1a\n')) return { kind: 'image', media: 'image/png' };
  if (at(0, '\xff\xd8\xff')) return { kind: 'image', media: 'image/jpeg' };
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return { kind: 'image', media: 'image/gif' };
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { kind: 'image', media: 'image/webp' };
  if (at(0, 'II*\0') || at(0, 'MM\0*')) return { kind: 'other', name: 'TIFF picture' };
  if (at(4, 'ftyp') && /^(heic|heix|heim|heis|hevc|mif1|msf1)$/.test(ascii(bytes, 8, 12))) return { kind: 'other', name: 'HEIC picture' };
  if (at(0, 'PK\x03\x04')) return { kind: 'other', name: 'Word or Zip file' };
  if (at(0, '\xd0\xcf\x11\xe0')) return { kind: 'other', name: 'Word file' };
  // A PDF may have other bytes before its header, up to 1,024 of them (ISO 32000-1, Annex H).
  if (ascii(bytes, 0, 1024 + 5).includes('%PDF-')) return { kind: 'pdf' };
  const start = textStart(bytes);
  if (/^\{\\rtf/.test(start)) return { kind: 'rtf' };
  // Comments, a declaration and a style sheet's line may come before the root element.
  const root = /^(?:<\?[^]*?\?>|<!--[^]*?-->|<!doctype[^>]*>|\s)*<(?:([\w.-]+):)?([\w.-]+)/i.exec(start);
  if (!root) return undefined;
  if (root[2] === 'ClinicalDocument') return { kind: 'cda' };
  if (/^(html|head|body)$/i.test(root[2]!) || /^\s*<!doctype html/i.test(start)) return { kind: 'html' };
  return /^\s*<\?xml/i.test(start) ? { kind: 'xml' } : undefined;
}

/** The start of a file as text, without its byte order mark; as UTF-16 where it starts with that mark's first byte, which no markup does. */
function textStart(bytes: Uint8Array): string {
  const label = bytes[0] === 0xff ? 'utf-16le' : bytes[0] === 0xfe ? 'utf-16be' : 'utf-8';
  return new TextDecoder(label).decode(bytes.subarray(0, 4096)).replace(/^\s+/, '');
}

/** What a paper is. */
export function paperType(mediaType: string | undefined, bytes: Uint8Array): PaperType {
  const found = signature(bytes);
  if (found) return found;
  switch ((mediaType ?? '').split(';')[0]!.trim().toLowerCase()) {
    case 'text/html':
    case 'application/xhtml+xml':
      return { kind: 'html' };
    case 'application/xml':
    case 'text/xml':
    case 'application/hl7-cda+xml':
      return { kind: 'xml' };
    case 'text/plain':
      return { kind: 'text' };
    default:
      return { kind: 'other' };
  }
}

// Types medrec files that no browser shows: there is nothing to ask for.
const NEVER = /^(image\/(tiff|hei[cf])|application\/(msword|zip|vnd\..*)|audio\/.*|video\/.*)$/;

/** Whether a paper filed as this type may show here: its bytes say, once they are read. */
export const mayShow = (mediaType: string | undefined): boolean => !NEVER.test((mediaType ?? '').split(';')[0]!.trim().toLowerCase());

/** The most a paper is read and shown at: above it, Drive's own viewer is the place. */
export const MOST_BYTES = 60 * 1024 * 1024;
/** Above this, the size is said before it is read. */
export const SAY_BYTES = 10 * 1024 * 1024;
