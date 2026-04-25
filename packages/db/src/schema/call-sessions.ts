import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { callStatusEnum } from './enums';
import { customers } from './customers';
import { claims } from './claims';

export const callSessions = pgTable('call_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').references(() => customers.id),
  claimId: uuid('claim_id').references(() => claims.id),
  twilioCallSid: text('twilio_call_sid').unique().notNull(),
  callerPhone: text('caller_phone').notNull(),
  status: callStatusEnum('status').default('active').notNull(),
  startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { mode: 'date' }),
  summary: text('summary'),
});
