import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from './trpc-setup';
import { prisma } from '@/lib/prisma';

// Root router with Prisma-backed queries
export const appRouter = router({
  // Public query to fetch bounties with optional filtering
  bounties: {
    list: publicProcedure
      .input(
        z.object({
          take: z.number().int().positive().default(10),
          cursor: z.string().optional(),
          status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
        })
      )
      .query(async ({ input }) => {
        const bounties = await prisma.bounty.findMany({
          take: input.take + 1, // +1 to determine hasNextPage
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }), // skip cursor itself
          where: {
            ...(input.status && { status: input.status }),
          },
          select: {
            id: true,
            title: true,
            description: true,
            budget: true,
            deadline: true,
            status: true,
            category: true,
            tags: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = bounties.length > input.take;
        if (hasNextPage) bounties.pop(); // Remove the extra item

        const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : null;

        return {
          bounties,
          nextCursor,
          hasNextPage,
        };
      }),

    // Protected query to fetch creator's own bounties
    myBounties: protectedProcedure
      .input(
        z.object({
          take: z.number().int().positive().default(10),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const bounties = await prisma.bounty.findMany({
          take: input.take + 1,
          ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
          where: {
            creatorId: ctx.user!.id,
          },
          select: {
            id: true,
            title: true,
            description: true,
            budget: true,
            deadline: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const hasNextPage = bounties.length > input.take;
        if (hasNextPage) bounties.pop();

        const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : null;

        return {
          bounties,
          nextCursor,
          hasNextPage,
        };
      }),

    // Public query to fetch single bounty by id
    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return await prisma.bounty.findUnique({
          where: { id: input.id },
          select: {
            id: true,
            title: true,
            description: true,
            budget: true,
            deadline: true,
            status: true,
            category: true,
            tags: true,
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        });
      }),
  },
});

export type AppRouter = typeof appRouter;
