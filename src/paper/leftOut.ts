/** Parts of pdf.js's warnings that say it left something of a page out: text, a picture, a shading, a form's field. */
export const LEFT_OUT = [
  'getOperatorList - ignoring XObject',
  'getOperatorList - ignoring Shading',
  'getOperatorList - ignoring errors',
  'getOperatorList - ignoring annotation',
  'getContentStream - ignoring sub-stream',
  'handleTilingType - ignoring pattern',
  'parseShading - ignoring shading',
  'buildFontPaths - ignoring',
  'loadFont - preEvaluateFont failed',
  'loadFont - translateFont failed',
  'Unable to decode image',
  'Unable to decode inline image',
  'Image dimensions are missing',
  'ignoring the rest of the image data',
  // Of a shading or a font that does not read, the error alone.
  'Warning: FormatError',
];
