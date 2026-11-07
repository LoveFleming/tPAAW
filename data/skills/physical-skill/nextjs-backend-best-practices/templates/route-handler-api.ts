/**
 * Next.js 16 — Route Handlers (API Endpoints)
 *
 * Route Handlers replace API Routes from Pages Router.
 * File: app/api/[...]/route.ts
 *
 * ⚠️ IMPORTANT — a single route.ts may export each HTTP method AT MOST ONCE
 * (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). Next.js ignores any other
 * export name (→ 405) and a duplicate method name fails to compile.
 *
 * This reference file gathers examples that each belong to a DIFFERENT route
 * file (see the `File:` note above every example). To keep the whole file a
 * valid, compilable route.ts, only the FIRST handler of a given method carries
 * the `export` keyword; later examples of the same method are plain functions.
 * When copying one of those into its own route file, add the `export` keyword
 * and name it with the HTTP method noted in its comment.
 */

import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { writeFile } from 'fs/promises'
import { basename, join } from 'path'

// ============================================================================
// Example 1: Basic CRUD API
// File: app/api/posts/route.ts
// ============================================================================

// GET /api/posts
export async function GET() {
  const r = await fetch('https://api.example.com/posts')
  if (!r.ok) {
    return NextResponse.json({ error: 'Upstream API error' }, { status: 502 })
  }

  const posts = await r.json()
  return NextResponse.json(posts)
}

// POST /api/posts
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.title !== 'string') {
    return NextResponse.json(
      { error: 'A string `title` is required' },
      { status: 400 }
    )
  }

  const r = await fetch('https://api.example.com/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: body.title }),
  })
  if (!r.ok) {
    return NextResponse.json({ error: 'Failed to create post' }, { status: 502 })
  }

  const post = await r.json()
  return NextResponse.json(post, { status: 201 })
}

// ============================================================================
// Example 2: Dynamic Routes
// File: app/api/posts/[id]/route.ts
// ============================================================================

// GET /api/posts/[id] — this file already exports GET (Example 1), so this
// handler is shown without the keyword. Copy it into app/api/posts/[id]/route.ts
// and export it there as `GET`.
async function getPostById(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params // ✅ Await params in Next.js 16

  const r = await fetch(`https://api.example.com/posts/${encodeURIComponent(id)}`)
  if (!r.ok) {
    return NextResponse.json(
      { error: 'Post not found' },
      { status: 404 }
    )
  }

  const post = await r.json()
  return NextResponse.json(post)
}

// PATCH /api/posts/[id] — first PATCH in this file, so it is exported.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const r = await fetch(`https://api.example.com/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    return NextResponse.json({ error: 'Failed to update post' }, { status: 502 })
  }

  const updated = await r.json()
  return NextResponse.json(updated)
}

// DELETE /api/posts/[id] — first DELETE in this file, so it is exported.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const r = await fetch(`https://api.example.com/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!r.ok) {
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 502 })
  }

  return NextResponse.json({ message: 'Post deleted' }, { status: 200 })
}

// ============================================================================
// Example 3: Search with Query Parameters
// File: app/api/search/route.ts — copy this handler there and export it as `GET`
// ============================================================================

// GET /api/search?q=nextjs&limit=10&page=1
async function searchPosts(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') ?? ''
  const limit = Number.parseInt(searchParams.get('limit') ?? '10', 10)
  const page = Number.parseInt(searchParams.get('page') ?? '1', 10)

  if (Number.isNaN(limit) || limit < 1 || Number.isNaN(page) || page < 1) {
    return NextResponse.json(
      { error: '`limit` and `page` must be positive integers' },
      { status: 400 }
    )
  }
  const offset = (page - 1) * limit

  // URLSearchParams encodes every value — never interpolate raw user input
  // into a URL string.
  const search = new URLSearchParams({
    q: query,
    limit: String(limit),
    offset: String(offset),
  })

  const r = await fetch(`https://api.example.com/search?${search}`)
  if (!r.ok) {
    return NextResponse.json({ error: 'Search failed' }, { status: 502 })
  }

  const results = await r.json()
  return NextResponse.json({
    results: results.items,
    total: results.total,
    page,
    limit,
  })
}

// ============================================================================
// Example 4: Authentication with Cookies
// ============================================================================

// POST /api/auth/login
// File: app/api/auth/login/route.ts — copy this handler there and export it as `POST`
async function login(request: Request) {
  const body = await request.json().catch(() => null)
  if (
    !body ||
    typeof body.email !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    )
  }

  // Verify credentials
  const r = await fetch('https://api.example.com/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  })
  const user = r.ok ? ((await r.json()) as { token?: string }) : null

  if (!user?.token) {
    return NextResponse.json(
      { error: 'Invalid credentials' },
      { status: 401 }
    )
  }

  // Set cookie
  const response = NextResponse.json({ success: true })
  response.cookies.set('token', user.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })

  return response
}

// GET /api/auth/me
// File: app/api/auth/me/route.ts — copy this handler there and export it as `GET`
async function getCurrentUser() {
  const cookieStore = await cookies() // ✅ Await cookies in Next.js 16
  const token = cookieStore.get('token')?.value

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const r = await fetch('https://api.example.com/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const user = await r.json()
  return NextResponse.json(user)
}

// ============================================================================
// Example 5: Webhook Handler
// File: app/api/webhooks/stripe/route.ts — copy this handler there and export it as `POST`
// ============================================================================

// Minimal shape of the Stripe events this example handles
type StripeEvent = {
  type: string
  data: { object: { id: string } }
}

async function stripeWebhook(request: Request) {
  const body = await request.text()
  const headersList = await headers() // ✅ Await headers in Next.js 16
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 400 }
    )
  }

  // Signature check — never trust an unverified webhook payload. With the
  // Stripe SDK the verification and the parse happen in one call:
  //   const event = stripe.webhooks.constructEvent(body, signature, secret)
  // The plain JSON.parse below keeps this template dependency-free; swap in
  // constructEvent in production so the signature is actually validated.
  let event: StripeEvent
  try {
    event = JSON.parse(body) as StripeEvent
  } catch {
    return NextResponse.json(
      { error: 'Invalid payload' },
      { status: 400 }
    )
  }

  // Handle event
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object)
      break
    case 'payment_intent.failed':
      await handlePaymentFailure(event.data.object)
      break
    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}

async function handlePaymentSuccess(paymentIntent: { id: string }) {
  console.log('Payment succeeded:', paymentIntent.id)
  // Update database, send confirmation email, etc.
}

async function handlePaymentFailure(paymentIntent: { id: string }) {
  console.log('Payment failed:', paymentIntent.id)
  // Notify user, log error, etc.
}

// ============================================================================
// Example 6: Streaming Response (SSE)
// File: app/api/stream/route.ts — copy this handler there and export it as `GET`
// ============================================================================

// GET /api/stream
async function sseStream() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 10; i++) {
        const data = `data: ${JSON.stringify({ count: i })}\n\n`
        controller.enqueue(encoder.encode(data))
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

// ============================================================================
// Example 7: File Upload
// File: app/api/upload/route.ts — copy this handler there and export it as `POST`
// ============================================================================

// POST /api/upload
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

async function uploadFile(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json(
      { error: 'No file provided' },
      { status: 400 }
    )
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 }
    )
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: 'File exceeds the 5 MB limit' },
      { status: 413 }
    )
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  // basename() strips any directory component; the replace() whitelist drops
  // every remaining character that is unsafe in a filename (path traversal).
  const safeName = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '')
  const filename = `${Date.now()}-${safeName}`
  const filePath = join(process.cwd(), 'public', 'uploads', filename)

  await writeFile(filePath, buffer)

  // ⚠️ Files written into public/ at runtime are NOT served by next start in
  // production — use blob/object storage (or a dedicated upload dir + route)
  // when you deploy.
  return NextResponse.json({
    success: true,
    url: `/uploads/${filename}`,
  })
}

// ============================================================================
// Example 8: CORS Configuration
// File: app/api/cors/route.ts — the OPTIONS handler below is exported; copy
// helloWithCors into the same file is NOT possible (GET already exported in
// Example 1) — put it in its own route file and export it as `GET` there.
// ============================================================================

// Allow a single explicit origin via env var — never '*' together with
// credentials, and avoid '*' in general (use an allowlist).
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'https://app.example.com'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

// GET /api/cors — demonstrates attaching CORS headers to a real response.
async function helloWithCors() {
  const response = NextResponse.json({ message: 'Hello' })

  response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  return response
}

// ============================================================================
// Example 9: Error Handling
// File: app/api/data/route.ts — copy this handler there and export it as `GET`
// ============================================================================

// GET /api/data
async function getWithErrorHandling() {
  try {
    const r = await fetch('https://api.example.com/data')
    if (!r.ok) {
      throw new Error(`Upstream API responded ${r.status}`)
    }
    const data = await r.json()

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error:', error)

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

// ============================================================================
// Example 10: Rate Limiting
// File: app/api/limited/route.ts — copy this handler (and the Map + consts
// above it) there and export it as `GET`
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

// GET /api/limited
async function rateLimitedGet() {
  const headersList = await headers()
  // ⚠️ x-forwarded-for is only trustworthy behind a reverse proxy, and an
  // in-memory Map is per-instance — for serverless/multi-instance deployments
  // move the counter to a shared store (e.g. Upstash Redis).
  const ip = headersList.get('x-forwarded-for') ?? 'unknown'
  const now = Date.now()

  // Prune expired entries so the Map stays bounded (no memory leak)
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetAt) rateLimitMap.delete(key)
  }

  const rateLimit = rateLimitMap.get(ip)

  if (rateLimit) {
    if (now < rateLimit.resetAt) {
      if (rateLimit.count >= RATE_LIMIT_MAX) {
        return NextResponse.json(
          { error: 'Too many requests' },
          { status: 429 }
        )
      }
      rateLimit.count++
    } else {
      rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    }
  } else {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
  }

  return NextResponse.json({ message: 'Success' })
}

/**
 * Summary:
 *
 * Route Handlers (app/api/[segment]/route.ts):
 * 1. ✅ Support all HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
 * 2. ✅ Await params in Next.js 16
 * 3. ✅ Access cookies with await cookies()
 * 4. ✅ Access headers with await headers()
 * 5. ✅ Use NextResponse.json() for JSON responses
 * 6. ✅ Return Response or NextResponse
 * 7. ✅ Export each HTTP method at most once per route.ts
 *
 * Common patterns:
 * - CRUD operations (GET, POST, PATCH, DELETE)
 * - Query parameters with searchParams (encode with URLSearchParams)
 * - Authentication with cookies
 * - Webhooks with signature verification (constructEvent)
 * - Streaming responses (SSE via ReadableStream)
 * - File uploads with FormData (sanitize filenames, cap size)
 * - CORS configuration (explicit origin allowlist)
 * - Error handling (check r.ok, try/catch)
 * - Rate limiting (prune expired entries)
 *
 * Best practices:
 * - Use try/catch for error handling
 * - Return appropriate HTTP status codes
 * - Validate input data
 * - Set secure cookie options in production
 * - Add rate limiting for public endpoints
 * - Use CORS headers when needed
 */
