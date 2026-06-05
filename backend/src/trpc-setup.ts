/**
 * tRPC Server Setup with Authentication and Tracing
 * 
 * Provides type-safe procedures with automatic context injection,
 * authentication middleware, and distributed tracing integration.
 */

import { TRPCError, initTRPC } from '@trpc/server';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tracingMiddleware } from '@/backend/services/tracing';
import jwt from 'jsonwebtoken';

// ─── Context Creation ─────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  name: string;
}

interface Context {
  req: NextRequest;
  headers?: Headers;
  user?: User;
  prisma: typeof prisma;
}

export async function createContext(req: NextRequest): Promise<Context> {
  const headers = req.headers;
  
  // Extract user from auth token if present
  let user: User | undefined;
  const authorization = headers.get('authorization');
  
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    try {
      const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      // Fetch user from database
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, name: true },
      });
      
      if (dbUser) {
        user = dbUser;
      }
    } catch (error) {
      // Invalid token - user stays undefined
      console.warn('Invalid JWT token:', error);
    }
  }

  return {
    req,
    headers,
    user,
    prisma,
  };
}

// ─── tRPC Initialization ──────────────────────────────────────────────────────

const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError: 
        error.cause instanceof Error && error.cause.name === 'ZodError'
          ? error.cause.flatten()
          : null,
    },
  }),
});

// ─── Middleware ───────────────────────────────────────────────────────────────

const tracingMw = t.middleware(({ next, path, type, ctx }) => {
  return tracingMiddleware({
    ctx: { headers: ctx.headers },
    next,
    path,
    type,
  });
});

const authMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// ─── Base Procedures ──────────────────────────────────────────────────────────

export const router = t.router;
export const publicProcedure = t.procedure.use(tracingMw);
export const protectedProcedure = t.procedure.use(tracingMw).use(authMiddleware);