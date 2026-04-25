export { authMiddleware as middleware } from '@/lib/auth.config';

export const config = {
  matcher: ['/((?!login|api/auth|api/upload|_next/static|_next/image|favicon\\.ico|upload).*)'],
};
