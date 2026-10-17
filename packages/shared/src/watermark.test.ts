import { describe, expect, it } from 'vitest';
import { stripWatermark, watermarkJsonObject, watermarkUserJs } from './watermark';

const SCRIPT = `// ==UserScript==
// @name clean
// @match https://axiom.trade/*
// ==/UserScript==
const filters = { ok: true };
`;

describe('watermark', () => {
  it('inserts a license line that strips back to the original userscript', () => {
    const marked = watermarkUserJs(SCRIPT, 'order-1', 'Wallet111', 'abc');
    expect(marked).toContain('// trenchmart-license: order-1 Wallet111 abc');
    expect(stripWatermark(marked)).toBe(SCRIPT);
  });

  it('splices a JSON field that strips back to the original object', () => {
    const original = '{"devHolding":"< 4%"}';
    const marked = watermarkJsonObject(original, 'order-2', 'Wallet111', 'def');
    expect(marked.startsWith('{"_trenchmart":')).toBe(true);
    expect(stripWatermark(marked)).toBe(original);
  });
});
