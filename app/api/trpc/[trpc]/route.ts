import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/backend/src/router';
import { createContext } from '@/backend/src/trpc-setup';
import { NextRequest } from 'next/server';

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
