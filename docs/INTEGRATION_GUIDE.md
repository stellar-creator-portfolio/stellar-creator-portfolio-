# N+1 Query Optimization - Integration Guide

## Quick Start (5 minutes)

### Step 1: Update Your Components

Replace individual review fetches with the new hook:

**Before:**

```typescript
// components/creator-reputation.tsx
const [payload, setPayload] = useState<FilteredReputationPayload | null>(null);

useEffect(() => {
  const url = `${API_BASE}/api/creators/${creatorId}/reviews?...`;
  fetch(url)
    .then((res) => res.json())
    .then(setPayload);
}, [creatorId]);
```

**After:**

```typescript
// components/creator-reputation.tsx
import { useCreatorReputation } from "@/lib/hooks/useCreatorReviews";

const { data: payload, loading } = useCreatorReputation(creatorId);
```

### Step 2: Verify DataLoaderProvider is in Layout

Already done! Check `app/layout.tsx` - it now wraps your app with `DataLoaderProvider`.

### Step 3: Test It

1. Open your browser DevTools (F12)
2. Go to Network tab
3. Navigate to creators list page
4. **Before**: You'd see 20+ individual `/api/creators/{id}/reviews` requests
5. **After**: You should see 1-2 batch requests to `/api/creators/reviews/batch`

## Performance Verification

### Method 1: Browser DevTools

1. Open DevTools → Network tab
2. Filter by "batch" to see batch requests
3. Compare request count and timing

### Method 2: Query Monitor

Add this to any component to see performance metrics:

```typescript
import { queryMonitor } from "@/lib/performance/query-monitor";

useEffect(() => {
  const timer = setTimeout(() => {
    queryMonitor.logReport();
  }, 2000);
  return () => clearTimeout(timer);
}, []);
```

### Method 3: Benchmarking

Run benchmarks in your browser console:

```typescript
import { benchmarkN1Queries } from "@/lib/performance/benchmark";
await benchmarkN1Queries();
```

## Migration Checklist

- [ ] Update `CreatorReputation` component to use `useCreatorReputation`
- [ ] Update `CreatorCard` component to use `useCreatorReviews` if needed
- [ ] Test creators list page loads faster
- [ ] Verify no console errors
- [ ] Check Network tab shows batch requests
- [ ] Run performance benchmarks
- [ ] Monitor PostgreSQL query logs for reduction

## Common Issues & Solutions

### Issue: "useDataLoaders must be used within DataLoaderProvider"

**Solution**: Ensure component is wrapped by `DataLoaderProvider`. Check `app/layout.tsx` has the provider.

### Issue: Still seeing individual requests

**Solution**:

1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+Shift+R)
3. Check that components are using the new hooks
4. Verify batch endpoints exist: `POST /api/creators/reviews/batch`

### Issue: Batch requests failing with 404

**Solution**: Ensure these files exist:

- `app/api/creators/reviews/batch/route.ts`
- `app/api/creators/reputation/batch/route.ts`

### Issue: DataLoader not batching

**Solution**:

- Ensure multiple components render in same tick
- Check batch schedule time (10ms default)
- Verify all components use `useCreatorReviews` hook

## Performance Targets

| Metric                  | Target | How to Verify        |
| ----------------------- | ------ | -------------------- |
| Queries for 20 creators | < 3    | DevTools Network tab |
| Response time           | < 50ms | DevTools Timing      |
| Database load           | Low    | PostgreSQL logs      |
| Memory usage            | < 10MB | DevTools Memory      |

## Rollback Plan

If issues occur, revert to individual requests:

1. Remove `DataLoaderProvider` from `app/layout.tsx`
2. Replace hook calls with direct `fetchCreatorReviews()` calls
3. Delete batch endpoint files (optional)

## Next Steps

1. **Database Indexes**: Add indexes on `creator_id` for faster queries
2. **GraphQL Layer**: Consider GraphQL for more flexible nested queries
3. **Caching Strategy**: Implement Redis caching for frequently accessed data
4. **Monitoring**: Set up alerts for N+1 query patterns

## Support

For issues or questions:

1. Check `docs/N1_QUERY_OPTIMIZATION.md` for detailed documentation
2. Review `lib/performance/query-monitor.ts` for debugging
3. Run benchmarks to verify improvements
