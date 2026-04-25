import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { evidenceFileTypeEnum, evidenceStatusEnum } from './enums';
import { claims } from './claims';
import { callSessions } from './call-sessions';

export const evidence = pgTable('evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').references(() => claims.id).notNull(),
  sessionId: uuid('session_id').references(() => callSessions.id),
  uploadToken: text('upload_token').unique().notNull(),
  fileName: text('file_name'),
  fileUrl: text('file_url'),
  fileType: evidenceFileTypeEnum('file_type').notNull(),
  status: evidenceStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
