import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { refresh_token } = await request.json()
    if (!refresh_token) {
      return NextResponse.json({ error: 'refresh_token is required' }, { status: 400 })
    }

    const authHost = process.env.API_HOST || '127.0.0.1'
    const authPort = process.env.AUTH_PORT || '3002'
    const backendUrl = `http://${authHost}:${authPort}/api/auth/refresh`

    const res = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Token refresh failed' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 })
  }
}
