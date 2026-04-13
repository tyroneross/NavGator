import { NextRequest, NextResponse } from 'next/server';
import { summarize } from '../../../src/llm.js';

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  const summary = await summarize(text);
  return NextResponse.json({ summary });
}
