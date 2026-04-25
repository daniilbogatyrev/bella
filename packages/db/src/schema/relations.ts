import { relations } from 'drizzle-orm';
import { customers } from './customers';
import { policies } from './policies';
import { claims } from './claims';
import { claimEvents } from './claim-events';
import { callSessions } from './call-sessions';
import { transcripts } from './transcripts';
import { evidence } from './evidence';

export const customersRelations = relations(customers, ({ many }) => ({
  policies: many(policies),
  claims: many(claims),
  callSessions: many(callSessions),
}));

export const policiesRelations = relations(policies, ({ one, many }) => ({
  customer: one(customers, { fields: [policies.customerId], references: [customers.id] }),
  claims: many(claims),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  customer: one(customers, { fields: [claims.customerId], references: [customers.id] }),
  policy: one(policies, { fields: [claims.policyId], references: [policies.id] }),
  events: many(claimEvents),
  callSessions: many(callSessions),
  evidence: many(evidence),
}));

export const claimEventsRelations = relations(claimEvents, ({ one }) => ({
  claim: one(claims, { fields: [claimEvents.claimId], references: [claims.id] }),
  session: one(callSessions, { fields: [claimEvents.sessionId], references: [callSessions.id] }),
}));

export const callSessionsRelations = relations(callSessions, ({ one, many }) => ({
  customer: one(customers, { fields: [callSessions.customerId], references: [customers.id] }),
  claim: one(claims, { fields: [callSessions.claimId], references: [claims.id] }),
  transcripts: many(transcripts),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  session: one(callSessions, { fields: [transcripts.sessionId], references: [callSessions.id] }),
}));

export const evidenceRelations = relations(evidence, ({ one }) => ({
  claim: one(claims, { fields: [evidence.claimId], references: [claims.id] }),
  session: one(callSessions, { fields: [evidence.sessionId], references: [callSessions.id] }),
}));
