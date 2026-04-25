'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { transitionClaim } from '../actions';

export function ClaimActions({
  claimId,
  canSubmit,
  canApprove,
  canDeny,
  canClose,
}: {
  claimId: string;
  canSubmit: boolean;
  canApprove: boolean;
  canDeny: boolean;
  canClose: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: 'submit' | 'approve' | 'deny' | 'close') {
    setLoading(action);
    setError(null);
    const result = await transitionClaim(claimId, action);
    setLoading(null);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Unknown error');
    }
  }

  const noActions = !canSubmit && !canApprove && !canDeny && !canClose;

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {noActions && (
        <p className="text-sm text-muted-foreground">
          No actions available for the current status.
        </p>
      )}

      {canSubmit && (
        <Button
          onClick={() => handleAction('submit')}
          disabled={loading !== null}
          className="w-full"
        >
          {loading === 'submit' ? 'Submitting…' : 'Submit Claim for Review'}
        </Button>
      )}

      {canApprove && (
        <Button
          onClick={() => handleAction('approve')}
          disabled={loading !== null}
          className="w-full"
        >
          {loading === 'approve' ? 'Approving…' : 'Approve Claim'}
        </Button>
      )}

      {canDeny && (
        <Button
          onClick={() => handleAction('deny')}
          disabled={loading !== null}
          variant="destructive"
          className="w-full"
        >
          {loading === 'deny' ? 'Denying…' : 'Deny Claim'}
        </Button>
      )}

      {canClose && (
        <Button
          onClick={() => handleAction('close')}
          disabled={loading !== null}
          variant="secondary"
          className="w-full"
        >
          {loading === 'close' ? 'Closing…' : 'Close Claim'}
        </Button>
      )}
    </div>
  );
}
