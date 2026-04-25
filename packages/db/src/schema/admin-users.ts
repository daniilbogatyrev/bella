import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminRoleEnum } from './enums';

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  role: adminRoleEnum('role').default('viewer').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
