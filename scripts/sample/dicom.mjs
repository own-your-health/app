// A small X-ray study as DICOM files, for the sample: invented, a few grey
// pixels an image. Explicit VR little endian, with the header tags a reader
// files a study by.

const LONG = new Set(['OB', 'OW', 'SQ', 'UN', 'UT']);

function element(group, tag, vr, value) {
  let bytes = Buffer.isBuffer(value) ? value : vr === 'US' ? Buffer.from(Uint16Array.of(value).buffer) : vr === 'UL' ? Buffer.from(Uint32Array.of(value).buffer) : Buffer.from(String(value), 'latin1');
  if (bytes.length % 2) bytes = Buffer.concat([bytes, Buffer.from(vr === 'UI' || vr === 'OB' ? '\0' : ' ')]);
  const head = Buffer.alloc(LONG.has(vr) ? 12 : 8);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(tag, 2);
  head.write(vr, 4, 'latin1');
  if (LONG.has(vr)) head.writeUInt32LE(bytes.length, 8);
  else head.writeUInt16LE(bytes.length, 6);
  return Buffer.concat([head, bytes]);
}

const DX = '1.2.840.10008.5.1.4.1.1.1.1';
const EXPLICIT = '1.2.840.10008.1.2.1';

/** One image of a study. */
export function image({ study, series, instance, person, born, date, description, accession, facility, bodyPart, number, view, side = 32 }) {
  const meta = Buffer.concat([element(2, 2, 'UI', DX), element(2, 3, 'UI', instance), element(2, 0x10, 'UI', EXPLICIT), element(2, 0x12, 'UI', '2.25.1')]);
  const pixels = Buffer.alloc(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) pixels[y * side + x] = Math.max(0, 220 - 16 * Math.abs(x - side / 2)) & 0xff;
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM'),
    element(2, 0, 'UL', meta.length),
    meta,
    element(8, 0x16, 'UI', DX),
    element(8, 0x18, 'UI', instance),
    element(8, 0x20, 'DA', date.replaceAll('-', '')),
    element(8, 0x50, 'SH', accession),
    element(8, 0x60, 'CS', 'DX'),
    element(8, 0x80, 'LO', facility),
    element(8, 0x1030, 'LO', description),
    element(8, 0x103e, 'LO', view),
    element(0x10, 0x10, 'PN', person),
    element(0x10, 0x30, 'DA', born.replaceAll('-', '')),
    element(0x18, 0x15, 'CS', bodyPart),
    element(0x20, 0x0d, 'UI', study),
    element(0x20, 0x0e, 'UI', series),
    element(0x20, 0x11, 'IS', number),
    element(0x20, 0x13, 'IS', 1),
    element(0x28, 2, 'US', 1),
    element(0x28, 4, 'CS', 'MONOCHROME2'),
    element(0x28, 0x10, 'US', side),
    element(0x28, 0x11, 'US', side),
    element(0x28, 0x100, 'US', 8),
    element(0x28, 0x101, 'US', 8),
    element(0x28, 0x102, 'US', 7),
    element(0x28, 0x103, 'US', 0),
    element(0x7fe0, 0x10, 'OB', pixels),
  ]);
}
