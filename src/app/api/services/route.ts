import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { indexService } from '@/lib/algolia-server'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const search = searchParams.get('search')

    const where: Record<string, unknown> = { status: 'active' }

    if (category && category !== 'All') {
      where.category = category
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { provider: { contains: search } },
      ]
    }

    const services = await db.service.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ services })
  } catch (error) {
    console.error('Error listing services:', error)
    return NextResponse.json(
      { error: 'Failed to list services' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, description, category, endpoint, pricePerCall, provider, providerAddr } = body

    if (!name || !description || !category || !endpoint || pricePerCall == null || !provider) {
      return NextResponse.json(
        { error: 'Missing required fields: name, description, category, endpoint, pricePerCall, provider' },
        { status: 400 }
      )
    }

    const apiKey = `apk_${crypto.randomBytes(24).toString('hex')}`

    const service = await db.service.create({
      data: {
        name,
        description,
        category,
        endpoint,
        pricePerCall: parseFloat(pricePerCall),
        provider,
        providerAddr: providerAddr || '',
        apiKey,
      },
    })

    // Best-effort: keep the Algolia marketplace index in sync.
    // Never throws and no-ops when Algolia is not configured.
    await indexService(service)

    return NextResponse.json({ service }, { status: 201 })
  } catch (error) {
    console.error('Error creating service:', error)
    return NextResponse.json(
      { error: 'Failed to create service' },
      { status: 500 }
    )
  }
}