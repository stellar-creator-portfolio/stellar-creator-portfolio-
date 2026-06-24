import { NextRequest, NextResponse } from 'next/server';

import { apiSuccess } from '@/lib/api-models';
import { searchCreators } from '@/lib/services/creators-data';

export async function GET(request: NextRequest) {
  const discipline = request.nextUrl.searchParams.get('discipline') ?? 'All';
  const freelancers = searchCreators({ discipline });

  return NextResponse.json(apiSuccess({ freelancers, total: freelancers.length }));
}
