import { pgTable, text, uuid, timestamp, date } from 'drizzle-orm/pg-core';
import { claimStatusEnum } from './enums';
import { customers } from './customers';
import { policies } from './policies';

export const claims = pgTable('claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  policyId: uuid('policy_id').references(() => policies.id),
  type: text('type').notNull(),
  status: claimStatusEnum('status').default('draft').notNull(),
  description: text('description'),
  incidentDate: date('incident_date'),
  incidentLocation: text('incident_location'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  submittedAt: timestamp('submitted_at', { mode: 'date' }),
});
