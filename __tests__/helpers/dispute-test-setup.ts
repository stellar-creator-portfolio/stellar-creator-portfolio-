/**
 * Test helpers for dispute tests.
 *
 * Provides an in-memory Prisma mock that mirrors the dispute schema,
 * plus a teardown function to reset state between tests.
 */

// In-memory stores keyed by id
const stores = {
  disputes: new Map<string, any>(),
  evidence: new Map<string, any>(),
  timeline: new Map<string, any>(),
  votes: new Map<string, any>(),
  resolutions: new Map<string, any>(),
  appeals: new Map<string, any>(),
  auditLogs: new Map<string, any>(),
};

let idCounter = 0;
function cuid(): string {
  return `c${++idCounter}_${Date.now().toString(36)}`;
}

/**
 * Reset all dispute-related stores. Call in beforeEach.
 */
export function resetDisputeStore(): void {
  stores.disputes.clear();
  stores.evidence.clear();
  stores.timeline.clear();
  stores.votes.clear();
  stores.resolutions.clear();
  stores.appeals.clear();
  stores.auditLogs.clear();
  idCounter = 0;
}

/**
 * Minimal Prisma-like client for dispute tests.
 * Supports the subset of operations used by the dispute router.
 */
export const testPrisma = {
  dispute: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = {
        ...data,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        preventionTags: data.preventionTags ?? [],
      };
      stores.disputes.set(id, record);
      return record;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return stores.disputes.get(where.id) ?? null;
    },
    findMany: async ({ where, include, orderBy, take, cursor, skip }: any = {}) => {
      let results = Array.from(stores.disputes.values());

      // Filter
      if (where) {
        results = results.filter((r) => {
          for (const [key, val] of Object.entries(where)) {
            if (r[key] !== val) return false;
          }
          return true;
        });
      }

      // Sort
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      // Cursor + skip
      if (cursor?.id && skip) {
        const idx = results.findIndex((r) => r.id === cursor.id);
        if (idx >= 0) results = results.slice(idx + 1);
      }

      // Take (with +1 for hasNextPage)
      if (take) results = results.slice(0, take);

      // Include relations
      if (include) {
        for (const r of results) {
          if (include.evidence) {
            r.evidence = Array.from(stores.evidence.values()).filter(
              (e) => e.disputeId === r.id,
            );
          }
          if (include.timeline) {
            r.timeline = Array.from(stores.timeline.values())
              .filter((t) => t.disputeId === r.id)
              .sort((a, b) =>
                include.timeline.orderBy?.at === 'desc'
                  ? b.at.getTime() - a.at.getTime()
                  : 0,
              );
          }
          if (include.communityVotes) {
            r.communityVotes = Array.from(stores.votes.values()).filter(
              (v) => v.disputeId === r.id,
            );
          }
          if (include.resolution) {
            r.resolution =
              Array.from(stores.resolutions.values()).find(
                (res) => res.disputeId === r.id,
              ) ?? null;
          }
          if (include.appeal) {
            r.appeal =
              Array.from(stores.appeals.values()).find(
                (a) => a.disputeId === r.id,
              ) ?? null;
          }
        }
      }

      return results;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = stores.disputes.get(where.id);
      if (!existing) throw new Error(`Dispute not found: ${where.id}`);
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    },
  },

  disputeEvidence: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = { ...data, id, submittedAt: new Date() };
      stores.evidence.set(id, record);
      return record;
    },
    findMany: async ({ where }: { where?: any } = {}) => {
      let results = Array.from(stores.evidence.values());
      if (where?.disputeId) {
        results = results.filter((r) => r.disputeId === where.disputeId);
      }
      return results;
    },
  },

  disputeTimelineEntry: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = { ...data, id, at: data.at ?? new Date() };
      stores.timeline.set(id, record);
      return record;
    },
  },

  disputeCommunityVote: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = { ...data, id, castAt: new Date() };
      stores.votes.set(id, record);
      return record;
    },
    findUnique: async ({
      where,
    }: {
      where: { disputeId_userId: { disputeId: string; userId: string } };
    }) => {
      return (
        Array.from(stores.votes.values()).find(
          (v) =>
            v.disputeId === where.disputeId_userId.disputeId &&
            v.userId === where.disputeId_userId.userId,
        ) ?? null
      );
    },
    findMany: async ({ where }: { where?: any } = {}) => {
      let results = Array.from(stores.votes.values());
      if (where?.disputeId) {
        results = results.filter((r) => r.disputeId === where.disputeId);
      }
      return results;
    },
  },

  disputeResolution: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = { ...data, id, resolvedAt: new Date() };
      stores.resolutions.set(id, record);
      return record;
    },
  },

  disputeAppeal: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = { ...data, id, submittedAt: new Date() };
      stores.appeals.set(id, record);
      return record;
    },
    findUnique: async ({ where }: { where: { disputeId: string } }) => {
      return (
        Array.from(stores.appeals.values()).find(
          (a) => a.disputeId === where.disputeId,
        ) ?? null
      );
    },
  },

  auditLog: {
    create: async ({ data }: { data: any }) => {
      const id = data.id ?? cuid();
      const record = { ...data, id, createdAt: new Date() };
      stores.auditLogs.set(id, record);
      return record;
    },
  },

  // Transaction support: execute callback with the same client
  $transaction: async (fn: (tx: any) => Promise<any>) => {
    return fn(testPrisma);
  },
};
