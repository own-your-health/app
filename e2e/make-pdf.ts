// Small PDFs for the paper tests, written here: invented words, and the things
// a PDF from anywhere may hold.

export interface PdfOptions {
  /** Entries of the catalog, of the trailer, and of each page. */
  catalog?: string;
  trailer?: string;
  page?: string;
  /** Objects after the pages', numbered from 100. */
  extra?: string[];
  /** More of each page's resources. */
  resources?: string;
  size?: [number, number];
}

/** A PDF of these pages, each its content stream. */
export function makePdf(pages: string[], opts: PdfOptions = {}): Buffer {
  const [w, h] = opts.size ?? [612, 792];
  const objects = new Map<number, string>();
  const kids = pages.map((_, i) => `${10 + i * 2} 0 R`).join(' ');
  objects.set(1, `<< /Type /Catalog /Pages 2 0 R ${opts.catalog ?? ''} >>`);
  objects.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((content, i) => {
    objects.set(10 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F 3 0 R >> ${opts.resources ?? ''} >> /Contents ${11 + i * 2} 0 R ${opts.page ?? ''} >>`);
    objects.set(11 + i * 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  (opts.extra ?? []).forEach((body, i) => objects.set(100 + i, body));
  let out = '%PDF-1.4\n';
  const at = new Map<number, number>();
  for (const [n, body] of objects) {
    at.set(n, out.length);
    out += `${n} 0 obj\n${body}\nendobj\n`;
  }
  const most = Math.max(...objects.keys());
  const start = out.length;
  out += `xref\n0 ${most + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= most; n++) out += at.has(n) ? `${String(at.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 00000 f \n';
  out += `trailer\n<< /Size ${most + 1} /Root 1 0 R ${opts.trailer ?? ''} >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A line of text at a place on a page. */
export const line = (text: string, y = 700): string => `BT /F 24 Tf 72 ${y} Td (${text}) Tj ET`;
