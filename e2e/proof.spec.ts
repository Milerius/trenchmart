import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { expect, test, type Page } from '@playwright/test';
import { ESCROW_PROGRAM_ID } from '../apps/web/src/lib/protocol-facts';

// An independent implementation of the documented format, as a third party would write it.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
const reportMessage = (r: unknown) =>
  new TextEncoder().encode(`trenchmart-scan-report:v1\n${canonical(r)}`);

const signer = nacl.sign.keyPair();
const publicKey = bs58.encode(signer.publicKey);
const report = {
  schema: 'trenchmart.scan-report/v1',
  cluster: 'devnet',
  listing: { slug: 'proof-pack', title: 'Proof Pack', category: 'userscript' },
  version: {
    id: 'v1',
    semver: '1.0.0',
    fileName: 'p.user.js',
    fileSize: 10,
    sha256: 'ab'.repeat(32),
  },
  steps: [
    {
      kind: 'static',
      engine: 'scanner@1.1.0',
      finishedAt: '2026-10-17T08:00:00.000Z',
      summary: 'pass',
      checks: [],
    },
  ],
  reviews: [
    {
      engine: 'rules@1.0.0',
      model: null,
      decision: 'approve',
      decidedAt: '2026-10-17T08:00:01.000Z',
    },
  ],
};
const signed = {
  report,
  signature: {
    alg: 'ed25519',
    publicKey,
    value: bs58.encode(nacl.sign.detached(reportMessage(report), signer.secretKey)),
  },
};
const member = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
const facts = {
  cluster: 'devnet',
  checkedAt: '2026-10-17T10:00:00.000Z',
  multisig: { address: member(7), threshold: 2, members: [member(1), member(2), member(3)] },
  program: {
    address: ESCROW_PROGRAM_ID,
    exists: true,
    programData: member(4),
    lastDeploySlot: '512000000',
    upgradeAuthority: member(8),
    deployedBytes: 177112,
    sha256: 'cd'.repeat(32),
    securityTxt: { name: 'TrenchMart Escrow' },
    verifiedBuild: { status: 'not_verified', detail: 'No reproducible build yet.' },
  },
  idl: { account: member(6), exists: true, instructions: ['fund', 'initialize'] },
  accounts: [
    { role: 'Treasury vault', address: member(8), exists: true, owner: '1111', lamports: '1' },
  ],
  review: {
    engine: 'rules@1.0.0',
    model: null,
    sandboxEngine: 'sandbox-isolate@1.0.0',
    note: 'Rules engine only.',
  },
  reportSigningKey: publicKey,
  recentEscrows: [
    {
      escrow: member(9),
      txSig: bs58.encode(new Uint8Array(64).fill(1)),
      releaseSig: null,
      refundSig: null,
      status: 'paid',
      total: '105000000',
      paidAt: '2026-10-17T09:00:00.000Z',
      escrowUntil: '2026-10-19T09:00:00.000Z',
      listing: { slug: 'proof-pack', title: 'Proof Pack' },
    },
  ],
};

async function stub(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/transparency') return route.fulfill({ json: facts });
    if (path === '/me')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHORIZED', message: 'x' } },
      });
    return route.fallback();
  });
}

test('the proof page shows live program, multisig and escrows, and checks a signed report', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/verify');
  const proof = page.getByTestId('proof');
  await expect(proof).toContainText('177112 bytes');
  await expect(proof).toContainText('cd'.repeat(32));
  await expect(proof.getByRole('list', { name: 'Instructions' })).toContainText('initialize');
  await expect(page.getByTestId('multisig')).toContainText('2 of 3 signers');
  // The upgrade authority is the Squads vault, so the chip says MULTISIG.
  await expect(proof.getByTestId('upgrade-authority')).toContainText('MULTISIG');
  await expect(page.getByTestId('proof-summary')).toContainText('6 of 7 checks confirmed');
  await expect(page.getByTestId('recent-escrows')).toContainText('Proof Pack');
  await expect(
    proof.locator(`a[href*="${ESCROW_PROGRAM_ID}?cluster=devnet"]`).first(),
  ).toBeVisible();

  const input = page.getByTestId('report-verifier').locator('input[type=file]');
  await input.setInputFiles({
    name: 'r.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(signed)),
  });
  await expect(page.getByTestId('report-verifier')).toContainText('Valid. Signed by the published');
  const tampered = {
    ...signed,
    report: { ...report, version: { ...report.version, sha256: '00' } },
  };
  await input.setInputFiles({
    name: 't.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tampered)),
  });
  await expect(page.getByTestId('report-verifier')).toContainText('Signature does not match');
});

test('the footer links the escrow program on devnet Explorer', async ({ page }) => {
  await stub(page);
  await page.goto('/docs/escrow');
  await expect(page.getByTestId('footer-program')).toHaveAttribute(
    'href',
    `https://explorer.solana.com/address/${ESCROW_PROGRAM_ID}?cluster=devnet`,
  );
});
