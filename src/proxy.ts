import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { COOKIE_NAME } from '@/lib/session'

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
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
}
