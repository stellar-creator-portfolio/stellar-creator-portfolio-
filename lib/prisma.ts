import { PrismaClient } from '@prisma/client';
import { createPrismaTracingMiddleware } from '@/backend/services/tracing';

function buildPrismaClient(): PrismaClient {
  const client = new PrismaClient();
  // Attach OpenTelemetry tracing middleware — creates a child span per DB query
  client.$use(createPrismaTracingMiddleware());
  return client;
}

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = buildPrismaClient();
} else {
  let globalWithPrisma = global as typeof global & {
    prisma: PrismaClient;
  };
  if (!globalWithPrisma.prisma) {
    globalWithPrisma.prisma = buildPrismaClient();
  }
  prisma = globalWithPrisma.prisma;
}

export { prisma };
