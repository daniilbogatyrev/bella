import { pgEnum } from 'drizzle-orm/pg-core';

export const adminRoleEnum = pgEnum('admin_role', ['admin', 'viewer']);
export const policyTypeEnum = pgEnum('policy_type', ['auto', 'health', 'liability', 'home', 'life', 'travel']);
export const policyStatusEnum = pgEnum('policy_status', ['active', 'expired', 'cancelled']);
export const claimStatusEnum = pgEnum('claim_status', ['draft', 'gathering_info', 'ready_for_review', 'submitted', 'under_review', 'approved', 'denied', 'closed']);
export const claimEventTypeEnum = pgEnum('claim_event_type', ['fact', 'observation', 'action', 'system']);
export const callStatusEnum = pgEnum('call_status', ['active', 'completed', 'failed']);
export const transcriptRoleEnum = pgEnum('transcript_role', ['customer', 'agent', 'system', 'tool']);
export const evidenceFileTypeEnum = pgEnum('evidence_file_type', ['photo', 'document', 'video']);
export const evidenceStatusEnum = pgEnum('evidence_status', ['pending', 'uploaded', 'verified']);
