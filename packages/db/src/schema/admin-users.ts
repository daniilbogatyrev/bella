import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { adminRoleEnum } from './enums';

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  role: adminRoleEnum('role').default('viewer').notNull(),
});
