import { PrismaClient } from '@prisma/client';
import { createPrismaTracingMiddleware } from '@/backend/services/tracing';
import { queryMonitor } from '@/lib/performance/query-monitor';

function buildPrismaClient(): PrismaClient {
  const client = new PrismaClient();

  // Attach OpenTelemetry tracing middleware — creates a child span per DB query
  client.$use(createPrismaTracingMiddleware());

  // Attach query monitoring in development — records every Prisma query for diagnostics
  if (process.env.NODE_ENV === 'development') {
    client.$on('query' as never, (e: { query: string; duration: number }) => {
      queryMonitor.recordPrismaQuery(e.query, e.duration);
    });
  }

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
