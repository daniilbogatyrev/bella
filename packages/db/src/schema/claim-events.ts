import { pgTable, text, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { claimEventTypeEnum } from './enums';
import { claims } from './claims';
import { callSessions } from './call-sessions';

export const claimEvents = pgTable('claim_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').references(() => claims.id).notNull(),
  sessionId: uuid('session_id').references(() => callSessions.id),
  type: claimEventTypeEnum('type').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
