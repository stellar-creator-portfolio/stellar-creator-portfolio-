import { initTRPC, TRPCError } from '@trpc/server';
import { getServerSession } from 'next-auth/next';
import type { Session } from 'next-auth';
import { tracingMiddleware } from '@/backend/services/tracing';

// Context provides authenticated user from NextAuth session
// Protected procedures reject unauthenticated requests with UNAUTHORIZED error
type CreateContextOptions = {
  session: Session | null;
  /** Request headers forwarded so tracing middleware can extract traceparent */
  headers?: Headers;
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

// ── OpenTelemetry tracing middleware ─────────────────────────────────────────
// Wraps every procedure with a root span that propagates the W3C traceparent
const otelTracingMiddleware = t.middleware((opts) =>
  tracingMiddleware({
    ctx: opts.ctx as Context & { headers?: Headers },
    next: opts.next as () => Promise<unknown>,
    path: opts.path,
    type: opts.type,
  }),
);

// Public procedure accessible without auth
export const publicProcedure = t.procedure.use(otelTracingMiddleware);

// Protected procedure that rejects unauthenticated requests
export const protectedProcedure = t.procedure.use(otelTracingMiddleware).use(({ ctx, next }) => {
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
