import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@trenchmart/shared';
import { combineVerdicts, runLlmReview, llmConfigured } from '@trenchmart/ai-verifier';
import { programHash, securityTxtOf } from './transparency';
import { sha256Hex } from './logic';

describe('program transparency helpers', () => {
  it('reads the embedded security.txt and hashes the program without zero padding', async () => {
    const block =
      '=======BEGIN SECURITY.TXT V1=======\0name\0TrenchMart Escrow\0project_url\0https://trenchmart.fun\0=======END SECURITY.TXT V1=======\0';
    const elf = new Uint8Array([...new TextEncoder().encode(`\x7fELF....${block}tail`), 0, 0, 0]);
    expect(securityTxtOf(elf)).toEqual({
      name: 'TrenchMart Escrow',
      project_url: 'https://trenchmart.fun',
    });
    expect(securityTxtOf(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await programHash(elf)).toBe(await sha256Hex(elf.subarray(0, elf.length - 3)));
  });

  it('canonicalises JSON with sorted keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null }, u: undefined })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('model review', () => {
  const rules = { agentId: 'a', decision: 'approve' as const, notes: 'rules ok.' };

  it('lets a model tighten a verdict but never loosen it', () => {
    expect(combineVerdicts(rules, { decision: 'reject', notes: 'bad', model: 'm' }).decision).toBe(
      'reject',
    );
    const reject = { ...rules, decision: 'reject' as const };
    expect(
      combineVerdicts(reject, { decision: 'approve', notes: 'fine', model: 'm' }).decision,
    ).toBe('reject');
    expect(combineVerdicts(rules, null)).toEqual(rules);
  });

  it('needs the full config and rejects malformed answers', async () => {
    expect(llmConfigured({ baseUrl: 'x', apiKey: '', model: 'm' })).toBe(false);
    const bad = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"decision":"yes"}' } }] }),
      )) as unknown as typeof fetch;
    await expect(
      runLlmReview(
        { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetch: bad },
        {
          title: 't',
          description: 'd',
          declared: {},
          fileName: 'f',
          fileExcerpt: '',
          checks: [],
          sandbox: { verdict: null, walletCalls: [], hosts: [] },
        },
      ),
    ).rejects.toThrow('no valid decision');
  });
});
