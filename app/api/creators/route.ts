import { NextRequest, NextResponse } from 'next/server';

import { apiSuccess } from '@/lib/api-models';
import { searchCreators } from '@/lib/services/creators-data';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const discipline = searchParams.get('discipline') ?? 'All';
  const query = searchParams.get('search') ?? '';
  const creators = searchCreators({ discipline, query });

  return NextResponse.json(apiSuccess({ creators, total: creators.length }));
}
