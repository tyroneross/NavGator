import { Queue, Worker, QueueEvents } from 'bullmq';
import { summarize } from './llm.js';
import { prisma } from './db.js';

const connection = { host: 'localhost', port: 6379 };

export const summarizationQueue = new Queue('summarization', { connection });
export const emailQueue = new Queue('email', { connection });

export const summarizationWorker = new Worker(
  'summarization',
  async (job) => {
    const { postId, body } = job.data;
    const summary = await summarize(body);
    await prisma.post.update({ where: { id: postId }, data: { body: summary } });
    return summary;
  },
  { connection, concurrency: 4 },
);

export const emailWorker = new Worker(
  'email',
  async (job) => {
    console.log('Sending email to', job.data.to);
  },
  { connection, concurrency: 8 },
);

export async function enqueueSummarize(postId: string, body: string) {
  return summarizationQueue.add('summarize', { postId, body }, { attempts: 3 });
}
