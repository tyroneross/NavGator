import { NextResponse } from 'next/server';
import { sweepExpiredSessions } from '../../../../src/db.js';

export async function GET() {
  const result = await sweepExpiredSessions();
  return NextResponse.json({ deleted: result.count });
}
