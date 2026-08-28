import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST() {
  // Generate a genuine secure random token for testing/demo purposes
  const token = crypto.randomBytes(32).toString('hex');
  return NextResponse.json({ accessToken: token });
}
