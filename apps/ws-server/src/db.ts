/**
 * Database operations for the SafeGuard Insurance platform.
 *
 * Uses PostgreSQL via the shared `@bella/db` package (Drizzle ORM + postgres driver).
 * All query functions maintain the same signatures used by callers
 * (tools.ts, session.ts, claims-actions.ts, conversational-ai.ts).
 */

import { getDb, customers, claims, claimEvents, callSessions, policies, transcripts } from "@bella/db";
import { eq } from "drizzle-orm";
import type {
  Customer as PgCustomer,
  NewCustomer as PgNewCustomer,
  Claim as PgClaim,
  ClaimEvent as PgClaimEvent,
  CallSession as PgCallSession,
  Transcript as PgTranscript,
} from "@bella/db";

// ---------------------------------------------------------------------------
// Exported types — aliased for caller compatibility
// ---------------------------------------------------------------------------

export type DbCustomer = PgCustomer;
export type NewCustomer = Pick<PgNewCustomer, "firstName" | "lastName" | "phone"> &
  Partial<Omit<PgNewCustomer, "firstName" | "lastName" | "phone">>;
export type DbClaim = PgClaim;
export type NewClaim = {
  customerId: string;
  policyId?: string | null;
  type: string;
  status?: string;
  description?: string;
};
export type DbClaimEvent = PgClaimEvent;
export type DbCallSession = PgCallSession;
export type DbTranscript = PgTranscript;

// ---------------------------------------------------------------------------
// Customer operations
// ---------------------------------------------------------------------------

export async function findCustomerByPhone(phone: string): Promise<DbCustomer | null> {
  const db = getDb();
  const [result] = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  return result ?? null;
}

export async function findCustomerById(id: string): Promise<DbCustomer | null> {
  const db = getDb();
  const [result] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result ?? null;
}

export async function createCustomer(data: NewCustomer): Promise<DbCustomer> {
  const db = getDb();
  const [result] = await db.insert(customers).values({
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone,
    email: data.email ?? null,
    dob: data.dob ?? null,
    address: data.address ?? null,
  }).returning();
  return result!;
}

// ---------------------------------------------------------------------------
// Claim operations
// ---------------------------------------------------------------------------

export async function findClaimById(claimId: string): Promise<DbClaim | null> {
  const db = getDb();
  const [result] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  return result ?? null;
}

export async function createClaim(data: NewClaim): Promise<DbClaim> {
  const db = getDb();
  const [result] = await db.insert(claims).values({
    customerId: data.customerId,
    policyId: data.policyId ?? null,
    type: data.type,
    status: (data.status as any) ?? "draft",
    description: data.description ?? null,
  }).returning();
  return result!;
}

export async function updateClaimStatus(claimId: string, status: string): Promise<void> {
  const db = getDb();
  await db.update(claims)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(claims.id, claimId));
}

// ---------------------------------------------------------------------------
// Claim event operations
// ---------------------------------------------------------------------------

export async function createClaimEvent(data: {
  claimId: string;
  type: string;
  description: string;
  metadata?: string | null;
}): Promise<void> {
  const db = getDb();
  await db.insert(claimEvents).values({
    claimId: data.claimId,
    type: data.type as any,
    content: data.description,
    metadata: data.metadata ? JSON.parse(data.metadata) : null,
  });
}

export async function findClaimEvents(claimId: string): Promise<DbClaimEvent[]> {
  const db = getDb();
  return db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId));
}

// ---------------------------------------------------------------------------
// Call session operations
// ---------------------------------------------------------------------------

export async function createCallSession(callSid: string, callerPhone?: string): Promise<DbCallSession> {
  const db = getDb();
  const [result] = await db.insert(callSessions).values({
    twilioCallSid: callSid,
    callerPhone: callerPhone ?? "unknown",
  }).returning();
  return result!;
}

export async function updateCallSessionCustomer(
  callSid: string,
  customerId: string,
): Promise<void> {
  const db = getDb();
  await db.update(callSessions)
    .set({ customerId })
    .where(eq(callSessions.twilioCallSid, callSid));
}

export async function completeCallSession(callSid: string, summary?: string): Promise<void> {
  const db = getDb();
  await db.update(callSessions)
    .set({ status: "completed", endedAt: new Date(), summary: summary ?? null })
    .where(eq(callSessions.twilioCallSid, callSid));
}

// ---------------------------------------------------------------------------
// Compound queries
// ---------------------------------------------------------------------------

export async function findClaimWithCustomer(
  claimId: string,
): Promise<{ claim: DbClaim; customer: DbCustomer | null } | null> {
  const db = getDb();
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  if (!claim) return null;

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, claim.customerId))
    .limit(1);

  return { claim, customer: customer ?? null };
}

// ---------------------------------------------------------------------------
// Transcript operations
// ---------------------------------------------------------------------------

/**
 * Save a transcript entry (user or agent message) linked to a call session.
 *
 * Looks up the call session DB row by `twilioCallSid` to get the UUID,
 * then inserts into the `transcripts` table.
 */
export async function saveTranscript(data: {
  callSid: string;
  role: "customer" | "agent" | "system" | "tool";
  content: string;
  toolName?: string | null;
  toolInput?: unknown;
  toolResult?: unknown;
}): Promise<void> {
  const db = getDb();

  const [session] = await db
    .select({ id: callSessions.id })
    .from(callSessions)
    .where(eq(callSessions.twilioCallSid, data.callSid))
    .limit(1);

  if (!session) return;

  await db.insert(transcripts).values({
    sessionId: session.id,
    role: data.role,
    content: data.content,
    toolName: data.toolName ?? null,
    toolInput: data.toolInput ?? null,
    toolResult: data.toolResult ?? null,
  });
}

/**
 * Update the caller phone number on an existing call session row.
 */
export async function updateCallSessionPhone(
  callSid: string,
  callerPhone: string,
): Promise<void> {
  const db = getDb();
  await db.update(callSessions)
    .set({ callerPhone })
    .where(eq(callSessions.twilioCallSid, callSid));
}
