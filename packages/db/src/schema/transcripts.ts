import { pgTable, text, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { transcriptRoleEnum } from './enums';
import { callSessions } from './call-sessions';

export const transcripts = pgTable('transcripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => callSessions.id).notNull(),
  role: transcriptRoleEnum('role').notNull(),
  content: text('content').notNull(),
  toolName: text('tool_name'),
  toolInput: jsonb('tool_input'),
  toolResult: jsonb('tool_result'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
