import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function getUserWithPosts(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { posts: { include: { tags: true } } },
  });
}

export async function createPost(authorId: string, title: string, body: string) {
  return prisma.post.create({
    data: { authorId, title, body },
  });
}

export async function countActiveSessions() {
  return prisma.session.count({
    where: { expiresAt: { gt: new Date() } },
  });
}

export async function sweepExpiredSessions() {
  return prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}

export async function findTagByName(name: string) {
  return prisma.tag.findUnique({ where: { name } });
}
