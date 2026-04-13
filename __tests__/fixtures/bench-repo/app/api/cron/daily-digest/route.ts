import { NextResponse } from 'next/server';
import { prisma } from '../../../../src/db.js';
import { summarize } from '../../../../src/llm.js';

export async function GET() {
  const recentPosts = await prisma.post.findMany({
    where: { createdAt: { gt: new Date(Date.now() - 86400000) } },
    take: 20,
  });
  const digest = await summarize(recentPosts.map((p) => p.title).join('\n'));
  return NextResponse.json({ digest });
}
