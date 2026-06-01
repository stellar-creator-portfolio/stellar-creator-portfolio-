import { prisma } from '@/lib/prisma';
import { BountyStatus } from '@prisma/client';

export interface BountyFilters {
  status?: BountyStatus;
  budget?: {
    min?: number;
    max?: number;
  };
}

export interface PaginatedBountiesResult {
  items: Array<{
    id: string;
    title: string;
    description: string;
    budget: number;
    deadline: Date;
    status: BountyStatus;
    category: string | null;
    tags: string[];
    createdAt: Date;
  }>;
  nextCursor: string | null;
  hasNextPage: boolean;
}

/**
 * Query bounties with cursor-based pagination and dynamic filtering
 * Uses take+1 pattern to determine hasNextPage without extra query
 * If take+1 results are returned, hasNextPage=true; otherwise hasNextPage=false
 * Server-wins conflict resolution treats server as source of truth
 */
export async function queryBounties(
  take: number,
  cursor: string | undefined,
  filters: BountyFilters,
): Promise<PaginatedBountiesResult> {
  // Build where clause with dynamic filters
  const where: any = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.budget) {
    where.budget = {};
    if (filters.budget.min !== undefined) {
      where.budget.gte = filters.budget.min;
    }
    if (filters.budget.max !== undefined) {
      where.budget.lte = filters.budget.max;
    }
  }

  // Query take+1 to determine if more results exist
  const items = await prisma.bounty.findMany({
    take: take + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1, // Skip cursor itself
    }),
    where,
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

  // Determine if more results exist
  const hasNextPage = items.length > take;
  if (hasNextPage) items.pop(); // Remove extra item

  const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

  return {
    items,
    nextCursor,
    hasNextPage,
  };
}
