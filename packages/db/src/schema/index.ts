// Enums
export * from './enums';

// Tables
export * from './admin-users';
export * from './customers';
export * from './policies';
export * from './claims';
export * from './claim-events';
export * from './call-sessions';
export * from './transcripts';
export * from './evidence';

// Relations
export * from './relations';

// Type exports
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { adminUsers } from './admin-users';
import { customers } from './customers';
import { policies } from './policies';
import { claims } from './claims';
import { claimEvents } from './claim-events';
import { callSessions } from './call-sessions';
import { transcripts } from './transcripts';
import { evidence } from './evidence';

export type AdminUser = InferSelectModel<typeof adminUsers>;
export type NewAdminUser = InferInsertModel<typeof adminUsers>;
export type Customer = InferSelectModel<typeof customers>;
export type NewCustomer = InferInsertModel<typeof customers>;
export type Policy = InferSelectModel<typeof policies>;
export type NewPolicy = InferInsertModel<typeof policies>;
export type Claim = InferSelectModel<typeof claims>;
export type NewClaim = InferInsertModel<typeof claims>;
export type ClaimEvent = InferSelectModel<typeof claimEvents>;
export type NewClaimEvent = InferInsertModel<typeof claimEvents>;
export type CallSession = InferSelectModel<typeof callSessions>;
export type NewCallSession = InferInsertModel<typeof callSessions>;
export type Transcript = InferSelectModel<typeof transcripts>;
export type NewTranscript = InferInsertModel<typeof transcripts>;
export type Evidence = InferSelectModel<typeof evidence>;
export type NewEvidence = InferInsertModel<typeof evidence>;
