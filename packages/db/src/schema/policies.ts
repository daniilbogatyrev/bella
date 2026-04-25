import { pgTable, text, uuid, timestamp, date, numeric, jsonb } from 'drizzle-orm/pg-core';
import { policyTypeEnum, policyStatusEnum } from './enums';
import { customers } from './customers';

export const policies = pgTable('policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  type: policyTypeEnum('type').notNull(),
  planName: text('plan_name').notNull(),
  status: policyStatusEnum('status').default('active').notNull(),
  premium: numeric('premium', { precision: 10, scale: 2 }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
