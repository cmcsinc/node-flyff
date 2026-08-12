export { auth as middleware } from '@/lib/auth';

// lib/auth imports lib/db, which lazily `require`s node:path/node:url. The
// Edge Runtime bundler cannot resolve `node:` schemes, so run the middleware
// on Node instead.
export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
