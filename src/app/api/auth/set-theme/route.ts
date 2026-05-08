import { NextResponse, type NextRequest } from 'next/server'

const THEMES = new Set(['system', 'light', 'dark'])

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { theme?: string }
  const theme = body.theme && THEMES.has(body.theme) ? body.theme : 'system'

  const res = NextResponse.json({ ok: true, theme })
  if (theme === 'system') {
    res.cookies.set('theme', '', { path: '/', expires: new Date(0) })
  } else {
    res.cookies.set('theme', theme, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }
  return res
}
