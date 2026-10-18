import type { CategoryCode } from './config';

export type CategoryMeta = {
  code: CategoryCode;
  label: string;
  short: string;
  tag: string;
  desc: string;
  color: string;
  bg: string;
};

export const CATEGORIES: CategoryMeta[] = [
  {
    code: 'userscript',
    label: 'Userscripts',
    short: '01 / SCRIPTS',
    tag: 'USERSCRIPT',
    desc: 'Tampermonkey add-ons for Axiom, GMGN, Photon, Terminal, Trojan.',
    color: '#C6F432',
    bg: '#141A10',
  },
  {
    code: 'wallet_list',
    label: 'Wallet lists',
    short: '02 / WALLETS',
    tag: 'WALLET LIST',
    desc: 'Curated smart-money and KOL tracker lists, ready to import.',
    color: '#7CC4FF',
    bg: '#0F1620',
  },
  {
    code: 'filter',
    label: 'Terminal filters',
    short: '03 / FILTERS',
    tag: 'FILTER',
    desc: 'Sniper and scanner presets for new pairs and migrations.',
    color: '#F5A524',
    bg: '#1C160A',
  },
  {
    code: 'setup',
    label: 'Full setups',
    short: '04 / SETUPS',
    tag: 'SETUP',
    desc: 'Layouts, hotkeys, alerts and presets bundled together.',
    color: '#C9A2FF',
    bg: '#18121F',
  },
  {
    code: 'strategy',
    label: 'Wallet strategies',
    short: '05 / STRATS',
    tag: 'STRATEGY',
    desc: 'Documented entry and exit playbooks with rules.',
    color: '#6EE7C8',
    bg: '#0E1A17',
  },
  {
    code: 'alerts',
    label: 'Alerts & bots',
    short: '06 / ALERTS',
    tag: 'ALERTS',
    desc: 'Telegram and Discord alert configs and webhooks.',
    color: '#FF8A7A',
    bg: '#1F1210',
  },
];

export function categoryMeta(code: string): CategoryMeta {
  return CATEGORIES.find((c) => c.code === code) ?? CATEGORIES[0]!;
}
