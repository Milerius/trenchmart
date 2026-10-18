'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { useWallet } from '@/lib/wallet';

/** Studio: end every signed-in browser of this wallet. Agent API keys are separate. */
export function SessionsCard() {
  const wallet = useWallet();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="rounded-panel border border-line bg-surface p-5 text-sm"
      data-testid="sessions-card"
    >
      <h2 className="m-0 text-base font-semibold">Sessions</h2>
      <p className="m-0 mt-1.5 text-[13px] text-muted">
        Signed in on another device, or lost one? Log out everywhere ends every wallet session on
        the server, this one included. Agent API keys keep working; revoke them in API keys.
      </p>
      {confirm ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            data-testid="logout-all-confirm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void wallet.logoutEverywhere().finally(() => setBusy(false));
            }}
          >
            {busy ? 'Logging out…' : 'Yes, log out everywhere'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="mt-3"
          data-testid="logout-all"
          onClick={() => setConfirm(true)}
        >
          Log out everywhere
        </Button>
      )}
    </div>
  );
}
