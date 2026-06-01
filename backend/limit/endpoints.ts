import { Router, Request, Response } from 'express';
import { queryBounties, type BountyFilters } from '../services/bounty.service';
import { z } from 'zod';

const router = Router();

// Validation schemas
const paginationSchema = z.object({
  take: z.number().int().positive().default(10),
  cursor: z.string().optional(),
});

const filtersSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  budget_min: z.number().int().nonnegative().optional(),
  budget_max: z.number().int().nonnegative().optional(),
});

/**
 * GET /bounties
 * Query bounties with cursor-based pagination and optional filtering
 *
 * Query Parameters:
 * - take: number (default 10) - number of items to return
 * - cursor: string (optional) - cursor for pagination
 * - status: enum (optional) - filter by bounty status
 * - budget_min: number (optional) - minimum budget filter
 * - budget_max: number (optional) - maximum budget filter
 */
router.get('/bounties', async (req: Request, res: Response) => {
  try {
    // Parse and validate query parameters
    const queryData = paginationSchema.parse({
      take: req.query.take ? parseInt(req.query.take as string) : 10,
      cursor: req.query.cursor as string | undefined,
    });

    const filterData = filtersSchema.parse({
      status: req.query.status as string | undefined,
      budget_min: req.query.budget_min ? parseInt(req.query.budget_min as string) : undefined,
      budget_max: req.query.budget_max ? parseInt(req.query.budget_max as string) : undefined,
    });

    // Build filters object
    const filters: BountyFilters = {};
    if (filterData.status) {
      filters.status = filterData.status as any;
    }
    if (filterData.budget_min !== undefined || filterData.budget_max !== undefined) {
      filters.budget = {};
      if (filterData.budget_min !== undefined) {
        filters.budget.min = filterData.budget_min;
      }
      if (filterData.budget_max !== undefined) {
        filters.budget.max = filterData.budget_max;
      }
    }

    const result = await queryBounties(queryData.take, queryData.cursor, filters);

    res.json({
      success: true,
      data: result.items,
      pagination: {
        nextCursor: result.nextCursor,
        hasNextPage: result.hasNextPage,
      },
    });
  } catch (error) {
    console.error('Error fetching bounties:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch bounties',
    });
  }
});

export default router;
