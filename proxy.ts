import { NextRequest, NextResponse } from 'next/server';

const SECRET = process.env.AUTH_SECRET || 'giuadel-fallback-secret';

const PUBLIC = ['/login', '/api/auth/login', '/api/ical/', '/api/admin/'];

async function tokenValido(token: string): Promise<boolean> {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // base64url → base64 → bytes
    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
    const sigBytes = Uint8Array.from(atob(b64(sig)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
    if (!ok) return false;

    const data = JSON.parse(atob(b64(payload)));
    return data.e > Date.now();
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('session')?.value;
  if (!token || !(await tokenValido(token))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|icon-.*\\.png).*)',
  ],
};
