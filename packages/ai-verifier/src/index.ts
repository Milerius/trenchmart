export const AI_AGENT_ID = 'trenchmart-ai-v1';
export const AI_ENGINE_VER = 'ai-verifier@1.0.0';

export type AiCheck = {
  ruleId: string;
  result: 'pass' | 'warn' | 'fail' | 'na' | string;
  title: string;
  detail: string;
};

export type AiDecisionName = 'approve' | 'reject' | 'request_changes';

export type AiDecision = {
  agentId: string;
  decision: AiDecisionName;
  notes: string;
};

const TRIVIAL = /^(ok|okay|lgtm|fine|looks good|noted|explained)\.?$/i;

/**
 * In-process automated verification agent.
 * It does not hold a wallet and it does not call a human reviewer.
 * An external model can replace this later via AI_VERIFIER_URL; the decision
 * shape stays the same.
 */
export function runAiVerifier(input: {
  checks: AiCheck[];
  creatorNote?: string | null;
  sandboxVerdict?: 'pass' | 'warn' | 'fail' | null;
  sandboxWalletCalls?: string[];
  agentId?: string;
}): AiDecision {
  const agentId = input.agentId || AI_AGENT_ID;
  const fails = input.checks.filter((c) => c.result === 'fail');
  const warns = input.checks.filter((c) => c.result === 'warn');
  const walletCalls = input.sandboxWalletCalls ?? [];

  if (input.sandboxVerdict === 'fail' || walletCalls.length > 0) {
    return {
      agentId,
      decision: 'reject',
      notes: `Automated verification rejected this version. The sandbox recorded a signing call or a failing verdict (${walletCalls.join(', ') || input.sandboxVerdict}).`,
    };
  }

  if (fails.length > 0) {
    return {
      agentId,
      decision: 'reject',
      notes: `Automated verification rejected this version. Failing checks: ${fails.map((f) => f.ruleId).join(', ')}.`,
    };
  }

  const explainable = [...warns];
  if (input.sandboxVerdict === 'warn') {
    explainable.push({
      ruleId: 'sandbox-network',
      result: 'warn',
      title: 'Sandbox network',
      detail: 'Sandbox reported a warning.',
    });
  }

  if (explainable.length > 0) {
    const note = (input.creatorNote ?? '').trim();
    if (note.length < 20 || TRIVIAL.test(note)) {
      return {
        agentId,
        decision: 'request_changes',
        notes: `Automated verification needs a real explanation of: ${explainable.map((w) => w.ruleId).join(', ')}.`,
      };
    }
    return {
      agentId,
      decision: 'approve',
      notes: `Automated verification accepted the creator explanation for ${explainable.map((w) => w.ruleId).join(', ')}.`,
    };
  }

  return {
    agentId,
    decision: 'approve',
    notes: 'Automated verification passed. Static checks are clean and the sandbox did not fail.',
  };
}

export function attestationMessage(input: {
  versionId: string;
  sha256: string;
  decision: AiDecisionName;
  issuedAt: string;
}): string {
  return `trenchmart-ai-attest:v1:${input.versionId}:${input.sha256}:${input.decision}:${input.issuedAt}`;
}

export async function signAttestation(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyAttestation(message: string, signature: string, secret: string): Promise<boolean> {
  const expected = await signAttestation(message, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
