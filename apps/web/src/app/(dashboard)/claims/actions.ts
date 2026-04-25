'use server';

import { getDb } from '@/lib/db';
import { claims, claimEvents, customers, policies } from '@bella/db';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not authenticated');
  return session;
}

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
  await requireAuth();

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

export async function getCustomers() {
  await requireAuth();
  const db = getDb();
  const rows = await db.query.customers.findMany({
    columns: { id: true, firstName: true, lastName: true, phone: true },
    orderBy: (c, { asc }) => [asc(c.lastName), asc(c.firstName)],
  });
  return rows;
}

export async function getCustomerPolicies(customerId: string) {
  await requireAuth();
  const db = getDb();
  const rows = await db.query.policies.findMany({
    where: eq(policies.customerId, customerId),
    columns: { id: true, type: true, planName: true, status: true },
  });
  return rows;
}

export async function createClaim(data: {
  customerId: string;
  policyId: string;
  type: string;
  description: string;
  incidentDate: string;
  incidentLocation?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  await requireAuth();

  if (!data.customerId) return { success: false, error: 'Customer is required' };
  if (!data.policyId) return { success: false, error: 'Policy is required' };
  if (!data.type) return { success: false, error: 'Claim type is required' };
  if (!data.description?.trim()) return { success: false, error: 'Description is required' };
  if (!data.incidentDate) return { success: false, error: 'Incident date is required' };

  try {
    const db = getDb();

    const [claim] = await db
      .insert(claims)
      .values({
        customerId: data.customerId,
        policyId: data.policyId,
        type: data.type,
        status: 'draft',
        description: data.description.trim(),
        incidentDate: data.incidentDate,
        incidentLocation: data.incidentLocation?.trim() || null,
      })
      .returning();

    await db.insert(claimEvents).values({
      claimId: claim!.id,
      type: 'system',
      content: 'Claim created from dashboard',
    });

    revalidatePath('/claims');
    return { success: true, id: claim!.id };
  } catch {
    return { success: false, error: 'Failed to create claim' };
  }
}
