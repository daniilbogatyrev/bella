import NextAuth from 'next-auth';
import { getDb } from '@/lib/db';
import { adminUsers } from '@bella/db';
import { eq } from 'drizzle-orm';
import { authConfig } from './auth.config';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      if (!user.email) return false;
      const db = getDb();
      const admin = await db.query.adminUsers.findFirst({
        where: eq(adminUsers.email, user.email),
      });
      if (!admin) return '/login?error=AccessDenied';
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const db = getDb();
        const admin = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.email, user.email),
        });
        if (admin) {
          token.role = admin.role;
          token.dbId = admin.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.dbId as string) ?? token.sub!;
        session.user.role = (token.role as string) ?? 'viewer';
      }
      return session;
    },
  },
});
