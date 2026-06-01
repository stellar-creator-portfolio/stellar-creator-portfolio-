import { initTRPC, TRPCError } from '@trpc/server';
import { getServerSession } from 'next-auth/next';
import type { Session } from 'next-auth';

// Context provides authenticated user from NextAuth session
// Protected procedures reject unauthenticated requests with UNAUTHORIZED error
type CreateContextOptions = {
  session: Session | null;
};

export async function createContext(opts?: CreateContextOptions): Promise<CreateContextOptions> {
  // If opts is provided (e.g., in tests), use it directly
  // Otherwise, try to get the session from NextAuth (in request context)
  let session = opts?.session ?? null;
  if (session === null && !opts) {
    try {
      session = await getServerSession();
    } catch {
      // If getServerSession fails (e.g., outside request context), leave session as null
      session = null;
    }
  }
  return {
    session,
  };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

// Public procedure accessible without auth
export const publicProcedure = t.procedure;

// Protected procedure that rejects unauthenticated requests
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required for this operation',
    });
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.session.user,
    },
  });
});

export const router = t.router;
export const middleware = t.middleware;
