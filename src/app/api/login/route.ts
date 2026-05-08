import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { sessionOptions, SessionData } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const hash = process.env.AUTH_PASSWORD_HASH;
  if (!hash) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!bcrypt.compareSync(password, hash)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.isLoggedIn = true;
  await session.save();

  return NextResponse.json({ success: true });
}