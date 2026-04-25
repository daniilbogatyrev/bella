import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import type { NextAuthConfig } from 'next-auth';

/**
 * Auth configuration shared between middleware (Edge) and server-side (Node.js).
 * DB-dependent logic lives in the full auth config in auth.ts.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user;
      const isOnLogin = request.nextUrl.pathname === '/login';
      if (isOnLogin) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;

export const { auth: authMiddleware } = NextAuth(authConfig);
