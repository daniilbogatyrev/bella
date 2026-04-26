/**
 * Claims action logic (shared between web app and tests).
 *
 * Pure business logic for claim approval, denial, and evidence requests.
 * No Next.js dependencies — usable from any Node/Bun context.
 */

import {
  findClaimWithCustomer,
  createClaimEvent,
  updateClaimStatus,
} from "./db.ts";

// Re-export for web app compatibility
export { findClaimWithCustomer, createClaimEvent, updateClaimStatus };

export interface ActionResult {
  success: boolean;
  message: string;
}

const SAFEGUARD_PHONE = "+49 30 7567 6653";

/**
 * Request a callback to collect additional evidence for a claim.
 *
 * Creates an evidence_requested claim event in the database.
 * Returns customer phone number for SMS sending by the caller.
 */
export async function requestEvidenceCallback(
  claimId: string,
): Promise<ActionResult & { smsTarget?: { phone: string; body: string } }> {
  const result = await findClaimWithCustomer(claimId);

  if (!result) {
    return { success: false, message: "Claim not found." };
  }

  const { claim, customer } = result;

  if (!["gathering_info", "ready_for_review"].includes(claim.status)) {
    return {
      success: false,
      message: `Cannot request evidence when claim is in "${claim.status}" status.`,
    };
  }

  await createClaimEvent({
    claimId: claim.id,
    type: "evidence_requested",
    description: "Callback requested for additional evidence",
    metadata: JSON.stringify({ requestedAt: new Date().toISOString() }),
  });

  let smsTarget: { phone: string; body: string } | undefined;
  if (customer?.phone) {
    const name = customer.firstName || "there";
    smsTarget = {
      phone: customer.phone,
      body:
        `Hi ${name}, SafeGuard Insurance needs additional evidence for your claim. ` +
        `We'll call you shortly, or you can call us at ${SAFEGUARD_PHONE}.`,
    };
  }

  return {
    success: true,
    message: "Evidence callback requested successfully.",
    smsTarget,
  };
}

/**
 * Approve a claim and transition its status to 'approved'.
 */
export async function approveClaim(claimId: string): Promise<ActionResult> {
  const result = await findClaimWithCustomer(claimId);

  if (!result) {
    return { success: false, message: "Claim not found." };
  }

  const { claim } = result;

  if (claim.status !== "under_review") {
    return {
      success: false,
      message: `Cannot approve claim in "${claim.status}" status. Must be "under_review".`,
    };
  }

  await updateClaimStatus(claim.id, "approved");

  await createClaimEvent({
    claimId: claim.id,
    type: "approved",
    description: "Claim approved by admin",
    metadata: JSON.stringify({ approvedAt: new Date().toISOString() }),
  });

  return { success: true, message: "Claim approved successfully." };
}

/**
 * Deny a claim with a reason and transition its status to 'denied'.
 */
export async function denyClaim(
  claimId: string,
  reason: string,
): Promise<ActionResult> {
  if (!reason.trim()) {
    return { success: false, message: "A denial reason is required." };
  }

  const result = await findClaimWithCustomer(claimId);

  if (!result) {
    return { success: false, message: "Claim not found." };
  }

  const { claim } = result;

  if (claim.status !== "under_review") {
    return {
      success: false,
      message: `Cannot deny claim in "${claim.status}" status. Must be "under_review".`,
    };
  }

  await updateClaimStatus(claim.id, "denied");

  await createClaimEvent({
    claimId: claim.id,
    type: "denied",
    description: `Claim denied by admin: ${reason}`,
    metadata: JSON.stringify({ deniedAt: new Date().toISOString(), reason }),
  });

  return { success: true, message: "Claim denied." };
}
