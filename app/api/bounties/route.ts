import { NextRequest, NextResponse } from 'next/server';

import { apiSuccess, paginatedData } from '@/lib/api-models';
import { parsePositiveInt, toApiBounty } from '@/lib/api-route-helpers';
import { bounties } from '@/lib/services/creators-data';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const limit = parsePositiveInt(searchParams.get('limit'), 10);
  const category = searchParams.get('category');
  const difficulty = searchParams.get('difficulty');
  const status = searchParams.get('status');

  let filtered = bounties;
  if (category) filtered = filtered.filter((bounty) => bounty.category === category);
  if (difficulty) filtered = filtered.filter((bounty) => bounty.difficulty === difficulty);
  if (status) filtered = filtered.filter((bounty) => bounty.status === status);

  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit).map(toApiBounty);

  return NextResponse.json(apiSuccess(paginatedData(items, page, limit, filtered.length)));
}
