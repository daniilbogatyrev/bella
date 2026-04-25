'use server';

import { getDb } from '@/lib/db';
import { claims } from '@bella/db';
import { eq } from 'drizzle-orm';

type ClaimAction = 'submit' | 'approve' | 'deny' | 'close';

const validTransitions: Record<string, string[]> = {
  submit: ['draft', 'gathering_info', 'ready_for_review'],
  approve: ['under_review'],
  deny: ['under_review'],
  close: ['approved', 'denied'],
};

const targetStatus: Record<ClaimAction, string> = {
  submit: 'submitted',
  approve: 'approved',
  deny: 'denied',
  close: 'closed',
};

export async function transitionClaim(
  claimId: string,
  action: ClaimAction
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDb();

    const [claim] = await db
      .select({ status: claims.status })
      .from(claims)
      .where(eq(claims.id, claimId))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found' };
    }

    const allowed = validTransitions[action];
    if (!allowed?.includes(claim.status)) {
      return {
        success: false,
        error: `Cannot ${action} a claim with status "${claim.status}"`,
      };
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: targetStatus[action],
      updatedAt: now,
    };

    if (action === 'submit') {
      updateData.submittedAt = now;
    }

    await db.update(claims).set(updateData).where(eq(claims.id, claimId));

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to update claim status' };
  }
}
