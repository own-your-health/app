// The sample's papers, as bytes: what a portal serves or a scanner makes.
// Everything in them is invented.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A photo or scan, drawn once and kept (scripts/sample/scans/). */
export const scan = (name) => readFileSync(join(HERE, 'scans', name));

const escaped = (s) => s.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, (c) => `\\${c}`);

/** A PDF of plain lines: each page a list of lines, its first the heading. */
export function pdf(...pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  pages.forEach(([heading, ...lines], i) => {
    const content = [`BT /F2 16 Tf 72 712 Td (${escaped(heading)}) Tj ET`, 'BT /F1 11 Tf 72 680 Td 18 TL', ...lines.map((l) => `(${escaped(l)}) Tj T*`), 'ET', ''].join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${6 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });
  let out = '%PDF-1.4\n';
  const at = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A portal's page, as its own HTML. */
export const html = (title, body) => Buffer.from(`<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n<h1>${title}</h1>\n${body.map(([tag, text]) => `<${tag}>${text}</${tag}>`).join('\n')}\n</body>\n</html>\n`);

/** A note a practice writes as rich text. */
export const rtf = (title, lines) => Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs32\\b ${title}\\b0\\fs22\\par\n${lines.map((l) => `${l}\\par`).join('\n')}\n}\n`, 'latin1');

/** A clinical document (C-CDA), as a practice's record system exports one. */
export const ccda = ({ title, code, person, born, on, from, sections }) =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <code code="${code}" codeSystem="2.16.840.1.113883.6.1" displayName="${title}"/>
  <title>${title}</title>
  <effectiveTime value="${on.replaceAll('-', '')}"/>
  <recordTarget><patientRole><patient><name><given>${person.split(' ')[0]}</given><family>${person.split(' ')[1]}</family></name><birthTime value="${born.replaceAll('-', '')}"/></patient></patientRole></recordTarget>
  <custodian><assignedCustodian><representedCustodianOrganization><name>${from}</name></representedCustodianOrganization></assignedCustodian></custodian>
  <component><structuredBody>
${sections.map(([heading, lines]) => `    <component><section><title>${heading}</title><text><list>${lines.map((l) => `<item>${l}</item>`).join('')}</list></text></section></component>`).join('\n')}
  </structuredBody></component>
</ClinicalDocument>
`,
  );
