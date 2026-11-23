import { PrismaClient } from '@prisma/client';
import { ensureDirectUrl } from './env';

// DIRECT_URL is optional in production: derived from DATABASE_URL if missing
ensureDirectUrl();

// نسخة واحدة من العميل لكل عملية Node (مهم في وضع التطوير و Serverless).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
