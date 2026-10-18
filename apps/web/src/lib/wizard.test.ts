import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  listingRequest,
  matchHosts,
  medianLamports,
  placeholdersLeft,
  readDraft,
  readUserscriptHeader,
  stepProblem,
  toggleTerminal,
  uncoveredTerminals,
  withKind,
} from './wizard';

describe('new-listing wizard', () => {
  it('needs a kind, then kind-specific answers', () => {
    const draft = emptyDraft();
    expect(stepProblem(draft, 1)).toMatch(/Pick what/);
    const script = withKind(draft, 'script');
    expect(stepProblem(script, 1)).toBeNull();
    expect(stepProblem(script, 2)).toMatch(/terminal/);
    const picked = { ...script, terminals: ['Axiom'] };
    expect(stepProblem(picked, 2)).toBeNull();
    const hosts = {
      ...picked,
      specs: { ...picked.specs, script: { ...picked.specs.script, network: 'hosts' as const } },
    };
    expect(stepProblem(hosts, 2)).toMatch(/host/);
    const bot = withKind(draft, 'bot');
    expect(stepProblem(bot, 2)).toBe('Pick the bot this config is for.');
    const other = withKind(draft, 'other');
    expect(stepProblem(other, 2)).toBe('Say in a few words what it is.');
  });

  it('switching kind follows untouched template sections and keeps edited ones', () => {
    const script = withKind(emptyDraft(), 'script');
    const edited = { ...script, text: { ...script.text, readme: '# Mine' } };
    const wallet = withKind(edited, 'wallet');
    expect(wallet.text.readme).toBe('# Mine');
    expect(wallet.text.howto).not.toBe(script.text.howto);
    expect(withKind({ ...script, terminals: ['Axiom'] }, 'bot').terminals).toEqual([]);
  });

  it('Any site clears specific terminals and back', () => {
    expect(toggleTerminal(['Axiom', 'GMGN'], 'Any')).toEqual(['Any']);
    expect(toggleTerminal(['Any'], 'Photon')).toEqual(['Photon']);
    expect(toggleTerminal(['Axiom'], 'Axiom')).toEqual([]);
  });

  it('validates details and pricing', () => {
    const draft = { ...withKind(emptyDraft(), 'filter'), terminals: ['Axiom'] };
    expect(stepProblem(draft, 3)).toMatch(/title/);
    const named = { ...draft, title: 'Rug filter', summary: 'Strict', description: 'Filters.' };
    expect(stepProblem(named, 3)).toBeNull();
    expect(stepProblem(named, 5)).toMatch(/price/);
    expect(stepProblem({ ...named, price: '1.2.3' }, 5)).toMatch(/price/);
    expect(stepProblem({ ...named, price: '0.5' }, 5)).toBeNull();
    expect(stepProblem({ ...named, price: '0.5', updatePrice: 'x' }, 5)).toMatch(/monthly/);
    expect(stepProblem(named, 6)).toMatch(/file/);
  });

  it('builds the create request with the kind category and no updates when off', () => {
    const draft = {
      ...withKind(emptyDraft(), 'wallet'),
      terminals: ['Axiom'],
      title: ' Smart wallets ',
      summary: 'Weekly',
      description: 'List',
      price: '0.8',
      updatesOn: false,
    };
    expect(listingRequest(draft, '0.08')).toMatchObject({
      title: 'Smart wallets',
      category: 'wallet_list',
      kind: 'wallet',
      priceLamports: '800000000',
      updatePriceLamports: '0',
      terminals: ['Axiom'],
    });
    expect(listingRequest({ ...draft, updatesOn: true }, '0.08').updatePriceLamports).toBe(
      '80000000',
    );
  });

  it('restores drafts defensively', () => {
    expect(readDraft(null)).toBeNull();
    expect(readDraft('{bad')).toBeNull();
    expect(readDraft(JSON.stringify({ version: 2 }))).toBeNull();
    const restored = readDraft(JSON.stringify({ version: 1, step: 99, kind: 'bot', title: 'x' }));
    expect(restored).toMatchObject({ step: 7, kind: 'bot', title: 'x' });
    expect(restored!.specs.script.managers.length).toBeGreaterThan(0);
  });

  it('median only with three or more real prices', () => {
    expect(medianLamports(['1', '2'])).toBeNull();
    expect(medianLamports(['3', '1', '2'])).toBe(2n);
    expect(medianLamports(['4', '1', '2', '3'])).toBe(2n);
  });

  it('counts [bracketed] template parts left', () => {
    expect(
      placeholdersLeft({ readme: '# [Script name]\n[One line]', howto: 'done', requirements: '' }),
    ).toBe(2);
    expect(placeholdersLeft({ readme: '- [x] ok', howto: '', requirements: '' })).toBe(0);
  });

  it('pre-checks a userscript header against the picked terminals', () => {
    const header = readUserscriptHeader(
      '// ==UserScript==\n// @name  Intel\n// @match https://axiom.trade/*\n// @match https://*.gmgn.ai/*\n// @grant GM_setValue\n// ==/UserScript==\n',
    );
    expect(header).toEqual({
      name: 'Intel',
      matches: ['https://axiom.trade/*', 'https://*.gmgn.ai/*'],
      grants: ['GM_setValue'],
    });
    expect(matchHosts(header!.matches)).toEqual(['axiom.trade', 'gmgn.ai']);
    expect(uncoveredTerminals(['Axiom', 'GMGN', 'Trojan'], header!.matches)).toEqual(['Trojan']);
    expect(readUserscriptHeader('console.log(1)')).toBeNull();
  });
});
