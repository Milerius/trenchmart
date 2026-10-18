import type { CategoryCode } from '@trenchmart/shared/config';

export type ContentField = 'readme' | 'howto' | 'requirements';
export type ContentTemplate = Record<ContentField, string>;

/**
 * Starter text per category for the README, How to use and Requirements tabs. It is only a
 * starting point: everything is editable, "Start blank" clears it, and the content review
 * checks whatever the seller submits. [Square brackets] mark what to replace.
 */
const USERSCRIPT: ContentTemplate = {
  readme: `# [Script name]

[One or two sentences: what it adds to which terminal, and why traders want it.]

## What it adds

- **[Feature]**: [what the buyer sees, where on the page]
- **[Feature]**: [...]

## What it does not do

- It never asks for, reads or stores a private key or seed phrase.
- It does not sign transactions. [Say exactly what any trade buttons do.]
- It talks only to [hosts it calls, e.g. the terminal's own API]. No third-party servers, no analytics.
- Settings are saved in your browser (\`localStorage\`) and nowhere else.
`,
  howto: `## Install

1. **Install Tampermonkey or Violentmonkey** from your browser's official store (Chrome Web Store, Firefox Add-ons or Microsoft Edge Add-ons). Get it only from these stores.
2. **Chrome and Edge only: allow user scripts.** Open \`chrome://extensions\`, open the extension's **Details** and switch on **Allow User Scripts** (older Chrome: **Developer mode**).
3. **Download the script** from this page after purchase.
4. **Open the file with the extension.** Drag it into a browser tab, or use **Dashboard → Utilities → Import from file**.
5. **Check the header before you install:** name, version and the \`@match\` sites should be [name], [version] and [site]. Click **Install**.
6. **Open [terminal URL] and log in.** [Where the script's button or panel appears.]

## Set it up

- [Settings and their defaults]

## Updating and removing

- To update, install the new file the same way.
- To remove it, use the trash icon next to the script in the extension's dashboard.
`,
  requirements: `- A desktop browser: Chrome, Brave, Edge or Firefox
- Tampermonkey 5+ or Violentmonkey 2.18+
- An account on [terminal]
`,
};

const WALLET_LIST: ContentTemplate = {
  readme: `# [List name]

[How many wallets, what kind (KOLs, snipers, insiders), and how you picked them.]

## What's inside

- **[N] wallets**, each with a label and a note
- Updated [how often]; last refresh [date]

## How the wallets were chosen

[Your criteria: win rate, hold time, size, how you filtered out bots.]
`,
  howto: `## Import

1. **Download the list** from this page after purchase. You get \`[file].csv\` (or \`.json\`).
2. **Open your terminal's wallet tracker:** [where it is in the terminal].
3. **Import** the file: [exact menu path]. The terminal shows [N] wallets.
4. **Check a few labels** against the list to confirm the import worked.

## Updating

- Import the new file the same way. Duplicates are [merged / skipped] by the terminal.
`,
  requirements: `- An account on [terminal] with wallet tracking
- [Plan or limit, if the terminal caps tracked wallets]
`,
};

const FILTER: ContentTemplate = {
  readme: `# [Filter name]

[What the filter surfaces on which terminal, and the idea behind it.]

## Settings

| Setting | Value | Why |
|---|---|---|
| [Market cap] | [range] | [reason] |
| [Holders] | [range] | [reason] |
`,
  howto: `## Apply the filter

1. **Download** the preset from this page after purchase.
2. Open **[terminal] → [filters panel]**.
3. **Import** the preset, or enter the values from the README.
4. **Save** it as a named filter so you can switch back.
`,
  requirements: `- An account on [terminal]
`,
};

const SETUP: ContentTemplate = {
  readme: `# [Setup name]

[What the full setup gives a trader: layout, scripts, filters, wallets.]

## What's included

- [Component and what it does]
- [Component and what it does]
`,
  howto: `## Setup steps

1. **Download** the archive from this page after purchase and unzip it.
2. [Install or import each part, in order]
3. [How to check everything works]

## Configuration

- [Settings to change before first use]
`,
  requirements: `- [Browser, extensions, terminal accounts]
- [Optional paid plans]
`,
};

const STRATEGY: ContentTemplate = {
  readme: `# [Strategy name]

[The idea in plain words. No promises of profit.]

## Rules

- **Entry:** [when]
- **Size:** [how much]
- **Exit:** [take profit / stop loss]
`,
  howto: `## Use it

1. **Download** the strategy file from this page after purchase.
2. [How to load it, or how to follow the rules by hand]
3. [How to track results]
`,
  requirements: `- [Terminal or tools]
`,
};

const ALERTS: ContentTemplate = {
  readme: `# [Bot / alert name]

[What it alerts on, where the alerts arrive, and how fast.]

## Alerts

- **[Alert]:** [trigger]
`,
  howto: `## Setup steps

1. **Download** the config from this page after purchase.
2. [Create the bot or webhook: exact steps]
3. [Paste the config and start it]
4. [Send a test alert]

## Never share

- Your bot token stays on your machine. This listing never asks for a private key or seed phrase.
`,
  requirements: `- [Telegram / Discord account, Node.js version, VPS if any]
`,
};

export const LISTING_TEMPLATES: Record<CategoryCode, ContentTemplate> = {
  userscript: USERSCRIPT,
  wallet_list: WALLET_LIST,
  filter: FILTER,
  setup: SETUP,
  strategy: STRATEGY,
  alerts: ALERTS,
};

export function templateFor(category: string): ContentTemplate {
  return LISTING_TEMPLATES[category as CategoryCode] ?? USERSCRIPT;
}
