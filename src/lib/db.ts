import { PrismaClient } from '@prisma/client';
import { applyDatabaseEnv } from './env';

// Accept DATABASE_URL, NETLIFY_DB_URL, NETLIFY_DATABASE_URL, POSTGRES_PRISMA_URL...; DIRECT_URL is derived if missing
applyDatabaseEnv();

// نسخة واحدة من العميل لكل عملية Node (مهم في وضع التطوير و Serverless).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
