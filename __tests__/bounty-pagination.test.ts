import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryBounties, type BountyFilters } from '@/backend/services/bounty.service';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bounty: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
const mockPrisma = vi.mocked(prisma);

describe('Bounty Service - Cursor Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cursor-Based Pagination', () => {
    it('should return first page with hasNextPage true when more items exist', async () => {
      const mockBounties = Array.from({ length: 11 }, (_, i) => ({
        id: `bounty-${String(i).padStart(2, '0')}`,
        title: `Bounty ${i}`,
        description: `Description ${i}`,
        budget: 1000 + i * 100,
        deadline: new Date('2025-12-31'),
        status: 'OPEN' as const,
        category: 'Design',
        tags: ['ui'],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, {});

      expect(result.items).toHaveLength(10);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextCursor).toBe('bounty-09');
      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        where: {},
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return last page with hasNextPage false', async () => {
      const mockBounties = Array.from({ length: 5 }, (_, i) => ({
        id: `bounty-${i}`,
        title: `Bounty ${i}`,
        description: `Description ${i}`,
        budget: 1000,
        deadline: new Date('2025-12-31'),
        status: 'OPEN' as const,
        category: 'Design',
        tags: [],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, {});

      expect(result.items).toHaveLength(5);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBe('bounty-4');
    });

    it('should use cursor for pagination skip', async () => {
      const mockBounties = Array.from({ length: 11 }, (_, i) => ({
        id: `bounty-${i + 10}`,
        title: `Bounty ${i + 10}`,
        description: `Description ${i}`,
        budget: 1000,
        deadline: new Date('2025-12-31'),
        status: 'OPEN' as const,
        category: 'Design',
        tags: [],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, 'bounty-09', {});

      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        cursor: { id: 'bounty-09' },
        skip: 1,
        where: {},
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result.items).toHaveLength(10);
    });

    it('should return empty array with no nextCursor when no results', async () => {
      mockPrisma.bounty.findMany.mockResolvedValue([]);

      const result = await queryBounties(10, undefined, {});

      expect(result.items).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('Status Filter', () => {
    it('should filter bounties by status', async () => {
      const mockBounties = Array.from({ length: 3 }, (_, i) => ({
        id: `bounty-${i}`,
        title: `Completed Bounty ${i}`,
        description: `Description ${i}`,
        budget: 1000,
        deadline: new Date('2025-12-31'),
        status: 'COMPLETED' as const,
        category: 'Design',
        tags: [],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, { status: 'COMPLETED' });

      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        where: { status: 'COMPLETED' },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result.items).toHaveLength(3);
      expect(result.items.every(b => b.status === 'COMPLETED')).toBe(true);
    });

    it('should support filtering by IN_PROGRESS status', async () => {
      const mockBounties = [
        {
          id: 'bounty-1',
          title: 'In Progress Bounty',
          description: 'Description',
          budget: 5000,
          deadline: new Date('2025-12-31'),
          status: 'IN_PROGRESS' as const,
          category: 'Development',
          tags: ['backend'],
          createdAt: new Date('2025-06-01'),
        },
      ];

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, { status: 'IN_PROGRESS' });

      expect(result.items[0].status).toBe('IN_PROGRESS');
    });
  });

  describe('Budget Filter', () => {
    it('should filter by minimum budget', async () => {
      const mockBounties = Array.from({ length: 5 }, (_, i) => ({
        id: `bounty-${i}`,
        title: `Bounty ${i}`,
        description: `Description ${i}`,
        budget: 5000 + i * 1000,
        deadline: new Date('2025-12-31'),
        status: 'OPEN' as const,
        category: 'Design',
        tags: [],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, {
        budget: { min: 5000 },
      });

      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        where: { budget: { gte: 5000 } },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result.items.every(b => b.budget >= 5000)).toBe(true);
    });

    it('should filter by maximum budget', async () => {
      const mockBounties = Array.from({ length: 3 }, (_, i) => ({
        id: `bounty-${i}`,
        title: `Bounty ${i}`,
        description: `Description ${i}`,
        budget: 1000 + i * 500,
        deadline: new Date('2025-12-31'),
        status: 'OPEN' as const,
        category: 'Design',
        tags: [],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, {
        budget: { max: 3000 },
      });

      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        where: { budget: { lte: 3000 } },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result.items.every(b => b.budget <= 3000)).toBe(true);
    });

    it('should filter by budget range (min and max)', async () => {
      const mockBounties = Array.from({ length: 4 }, (_, i) => ({
        id: `bounty-${i}`,
        title: `Bounty ${i}`,
        description: `Description ${i}`,
        budget: 2000 + i * 1000,
        deadline: new Date('2025-12-31'),
        status: 'OPEN' as const,
        category: 'Design',
        tags: [],
        createdAt: new Date('2025-06-01'),
      }));

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, {
        budget: { min: 2000, max: 5000 },
      });

      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        where: {
          budget: {
            gte: 2000,
            lte: 5000,
          },
        },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result.items.every(b => b.budget >= 2000 && b.budget <= 5000)).toBe(true);
    });
  });

  describe('Combined Filters', () => {
    it('should apply both status and budget filters', async () => {
      const mockBounties = [
        {
          id: 'bounty-1',
          title: 'Open High Budget Bounty',
          description: 'Description',
          budget: 10000,
          deadline: new Date('2025-12-31'),
          status: 'OPEN' as const,
          category: 'Design',
          tags: [],
          createdAt: new Date('2025-06-01'),
        },
      ];

      mockPrisma.bounty.findMany.mockResolvedValue(mockBounties);

      const result = await queryBounties(10, undefined, {
        status: 'OPEN',
        budget: { min: 5000 },
      });

      expect(mockPrisma.bounty.findMany).toHaveBeenCalledWith({
        take: 11,
        where: {
          status: 'OPEN',
          budget: { gte: 5000 },
        },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result.items[0].status).toBe('OPEN');
      expect(result.items[0].budget).toBeGreaterThanOrEqual(5000);
    });
  });
});
