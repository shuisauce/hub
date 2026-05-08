import { NextResponse, type NextRequest } from 'next/server'
import { SignJWT, jwtVerify } from 'jose'
import { COOKIE_NAME, SESSION_DURATION_MS } from '@/lib/session'

async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const secret = process.env.SESSION_SECRET
  if (!secret) return false
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    })
    return true
  } catch {
    return false
  }
}

// Issue a fresh 10-minute session cookie on every authenticated request, so
// active use keeps the user logged in (sliding expiry) while idle tabs expire
// on their own.
async function refreshSessionCookie(res: NextResponse) {
  const secret = process.env.SESSION_SECRET
  if (!secret) return
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  const token = await new SignJWT({ ok: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret))
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  })
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public iCal feed — token is the auth.
  if (pathname.startsWith('/api/ical/')) return NextResponse.next()

  const token = request.cookies.get(COOKIE_NAME)?.value
  const valid = await isValidSession(token)

  if (pathname === '/login') {
    if (valid) return NextResponse.redirect(new URL('/', request.url))
    return NextResponse.next()
  }

  if (!valid) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  const res = NextResponse.next()
  await refreshSessionCookie(res)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
}
