import { NextRequest, NextResponse } from 'next/server'

import { apiFailure, apiSuccess } from '@/lib/api-models'
import { getCreatorById, isValidCreatorId } from '@/lib/services/creators-data'

type CreatorRouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: NextRequest, context: CreatorRouteContext) {
  const { id } = await context.params

  if (!isValidCreatorId(id)) {
    return NextResponse.json(
      apiFailure('BAD_REQUEST', 'Invalid creator id'),
      { status: 400 },
    )
  }

  const creator = getCreatorById(id)
  if (!creator) {
    return NextResponse.json(
      apiFailure('NOT_FOUND', 'Creator not found'),
      { status: 404 },
    )
  }

  return NextResponse.json(apiSuccess(creator))
}
