import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/lib/db';
import { adminUsers, verifyPassword } from '@bella/db';
import { eq } from 'drizzle-orm';
import { authConfig } from './auth.config';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;

        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }

        const db = getDb();
        const admin = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.email, email.trim().toLowerCase()),
        });

        if (!admin) return null;

        if (!admin.passwordHash) {
          throw new Error('NoPassword');
        }

        const valid = await verifyPassword(password, admin.passwordHash);
        if (!valid) return null;

        return {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          image: admin.image,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (!user.email) return false;

      if (account?.provider === 'credentials') {
        return true;
      }

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
