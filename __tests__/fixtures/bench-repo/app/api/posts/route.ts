import { NextRequest, NextResponse } from 'next/server';
import { createPost, getUserWithPosts } from '../../../src/db.js';
import { enqueueSummarize } from '../../../src/queue.js';
import { classifyTag } from '../../../src/llm.js';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  const user = await getUserWithPosts(userId);
  return NextResponse.json(user);
}

export async function POST(req: NextRequest) {
  const { authorId, title, body } = await req.json();
  const post = await createPost(authorId, title, body);
  const tags = await classifyTag(body);
  await enqueueSummarize(post.id, body);
  return NextResponse.json({ post, tags }, { status: 201 });
}
