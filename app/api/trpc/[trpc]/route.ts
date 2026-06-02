import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/backend/src/router';
import { createContext } from '@/backend/src/trpc-setup';
import { initializeTracing } from '@/backend/services/tracing';
import { NextRequest } from 'next/server';

// Initialize OpenTelemetry once when this module is first loaded.
// In Next.js, this runs in the Node.js runtime on first request.
initializeTracing();

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async () => {
      const session = await (await import('next-auth/next')).getServerSession();
      // Forward request headers into the tRPC context so the tracing
      // middleware can extract the W3C traceparent header.
      return createContext({ session, headers: req.headers as unknown as Headers });
    },
  });

export { handler as GET, handler as POST };
