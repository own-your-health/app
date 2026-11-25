import { describe, expect, it } from 'vitest';
import { safeHref, safeSrcset } from '../src/ui/dom';

describe('safeHref', () => {
  it('keeps the app’s own and https addresses, and drops any other scheme', () => {
    expect(safeHref('./privacy.html')).toBe('./privacy.html');
    expect(safeHref('https://own-your-health.github.io/')).toBe('https://own-your-health.github.io/');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('tel:+15550100123')).toBe('tel:+15550100123');
    for (const u of ['tel:*31#5550100', 'tel:555;ext=1', 'tel:', 'tel:5550100123,,9']) expect(safeHref(u)).toBe('#');
    expect(safeHref('//example.com/x')).toBe('#');
  });
});

describe('safeSrcset', () => {
  it('keeps a srcset of the app’s own images, each with a density or a width', () => {
    expect(safeSrcset('./a-1x.png 1x,./a-2x.png 2x')).toBe('./a-1x.png 1x, ./a-2x.png 2x');
    expect(safeSrcset('./a-small.png 180w, ./a-large.png 720w')).toBe('./a-small.png 180w, ./a-large.png 720w');
  });

  it('drops the whole srcset when any image is another scheme, has a comma, or lacks its descriptor', () => {
    expect(safeSrcset('./a.png 1x, javascript:alert(1) 2x')).toBeNull();
    expect(safeSrcset('./a.png 1x, data:image/png;base64,AAAA 2x')).toBeNull();
    expect(safeSrcset('./a.png 1x, ./b.png 2x javascript:alert(1)')).toBeNull();
    expect(safeSrcset('./a.png')).toBeNull();
  });
});
