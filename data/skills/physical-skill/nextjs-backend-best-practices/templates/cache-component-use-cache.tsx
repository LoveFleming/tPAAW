/**
 * Next.js 16 - Cache Components with "use cache" Directive
 *
 * NEW in Next.js 16: Explicit opt-in caching with "use cache" directive.
 * Replaces implicit caching from Next.js 15.
 *
 * This template shows component-level, function-level, and page-level caching.
 */

// ============================================================================
// Example 1: Component-Level Caching
// ============================================================================

// This entire component will be cached.
// NOTE: "use cache" must be the FIRST statement inside the function/component
// body (not a file-level directive). A file-level "use cache" would cache
// EVERY export in the file — which is not what these standalone examples want.
export async function CachedProductList() {
  'use cache'

  const products = await fetch('https://api.example.com/products')
    .then(r => r.json())

  return (
    <div>
      <h2>Products</h2>
      <ul>
        {products.map((product: { id: string; name: string; price: number }) => (
          <li key={product.id}>
            {product.name} - ${product.price}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ============================================================================
// Example 2: Function-Level Caching
// ============================================================================

// File: lib/data.ts

export async function getExpensiveData(id: string) {
  'use cache' // Cache only this function's return value

  console.log('Fetching expensive data...') // Only logs on cache miss

  // Simulate expensive operation
  await new Promise(resolve => setTimeout(resolve, 1000))

  const data = await fetch(`https://api.example.com/items/${id}`)
    .then(r => r.json())

  return data
}

// Usage in component (not cached itself):
import { getExpensiveData } from '@/lib/data'

export async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getExpensiveData(id) // Cached by function

  return (
    <div>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
    </div>
  )
}

// ============================================================================
// Example 3: Page-Level Caching
// ============================================================================

// File: app/blog/[slug]/page.tsx

// NOTE: generateStaticParams runs at BUILD time to enumerate static routes.
// It is NOT a cached function — do NOT add "use cache" here. Caching applies to
// the page/component that renders the fetched data, not to route enumeration.
export async function generateStaticParams() {
  const posts = await fetch('https://api.example.com/posts')
    .then(r => r.json())

  return posts.map((post: { slug: string }) => ({
    slug: post.slug,
  }))
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  'use cache'

  const { slug } = await params

  const post = await fetch(`https://api.example.com/posts/${slug}`)
    .then(r => r.json())

  return (
    <article>
      <h1>{post.title}</h1>
      {/* SECURITY: never inject untrusted HTML via dangerouslySetInnerHTML.
          Sanitize first (e.g. DOMPurify / sanitize-html) or render as text.
          The example below assumes post.content is NOT user-controlled; in
          production, replace with a sanitizer. */}
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </article>
  )
}

// ============================================================================
// Example 4: Partial Prerendering (PPR) - Mix Static & Dynamic
// ============================================================================

// File: app/dashboard/page.tsx

// Static component (cached) — "use cache" sits INSIDE this component only,
// so the dynamic sibling below is NOT affected.
async function StaticHeader() {
  'use cache'

  return (
    <header>
      <h1>My Dashboard</h1>
      <nav>
        <a href="/dashboard">Overview</a>
        <a href="/dashboard/settings">Settings</a>
      </nav>
    </header>
  )
}

// Dynamic component (NOT cached) — in real code this lives in its own file
// (components/dynamic-user-info.tsx) WITHOUT a "use cache" directive.
// It is shown inline here for readability; do NOT hoist "use cache" to a
// file level in this file, or this component would be cached too.
// File: components/dynamic-user-info.tsx
import { cookies } from 'next/headers'

async function DynamicUserInfo() {
  // Read cookies OUTSIDE any cached scope and pass values as arguments.
  const cookieStore = await cookies()
  const userId = cookieStore.get('userId')?.value

  if (!userId) {
    return <div>Please log in</div>
  }

  const user = await fetch(`https://api.example.com/users/${userId}`)
    .then(r => r.json())

  return (
    <div>
      <p>Welcome, {user.name}</p>
      <p>Balance: ${user.balance}</p>
    </div>
  )
}

// Page combines static + dynamic (Partial Prerendering)
import { DynamicUserInfo } from '@/components/dynamic-user-info'

export default function DashboardPage() {
  return (
    <div>
      <StaticHeader /> {/* Cached (static) */}
      <DynamicUserInfo /> {/* Not cached (dynamic) */}
    </div>
  )
}

// ============================================================================
// Example 5: Selective Caching with Multiple Functions
// ============================================================================

// Cache expensive operations, skip cheap ones

// Cached function — "use cache" inside the function body, so ONLY this
// function is cached; getRealtimeMetrics below stays uncached.
export async function getPopularPosts() {
  'use cache'

  const posts = await fetch('https://api.example.com/posts/popular')
    .then(r => r.json())

  return posts
}

// NOT cached (changes frequently)
export async function getRealtimeMetrics() {
  const metrics = await fetch('https://api.example.com/metrics/realtime')
    .then(r => r.json())

  return metrics
}

// Component uses both
export async function Dashboard() {
  const popularPosts = await getPopularPosts() // Cached
  const metrics = await getRealtimeMetrics() // NOT cached

  return (
    <div>
      <div>
        <h2>Popular Posts</h2>
        <ul>
          {popularPosts.map((post: { id: string; title: string }) => (
            <li key={post.id}>{post.title}</li>
          ))}
        </ul>
      </div>

      <div>
        <h2>Realtime Metrics</h2>
        <p>Active users: {metrics.activeUsers}</p>
        <p>Requests/min: {metrics.requestsPerMinute}</p>
      </div>
    </div>
  )
}

// ============================================================================
// Example 6: Cache with Revalidation (using tags)
// ============================================================================

// File: app/actions.ts
'use server'

import { revalidateTag } from 'next/cache'

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string
  const content = formData.get('content') as string

  await fetch('https://api.example.com/posts', {
    method: 'POST',
    body: JSON.stringify({ title, content }),
  })

  // Revalidate cached posts.
  // Next.js 16 uses the TWO-argument form: revalidateTag(tag, profile).
  // The 2nd arg is the `cacheLife` profile (e.g. 'max', 'default') and sets how
  // long stale content may be served. The old single-arg form is deprecated.
  revalidateTag('posts', 'max')
}

// File: lib/posts.ts

import { cacheTag, cacheLife } from 'next/cache'

export async function getPosts() {
  'use cache'
  cacheLife('max') // cache lifetime/profile for this scope

  // cacheTag() attaches a tag to this cache entry so it can be invalidated
  // on-demand via revalidateTag()/updateTag(). (Requires cacheComponents: true)
  cacheTag('posts')

  const response = await fetch('https://api.example.com/posts', {
    next: { tags: ['posts'] }, // ...or tag via fetch options
  })

  return response.json()
}

// ============================================================================
// Example 7: Conditional Caching (Cache Based on User Role)
// ============================================================================

import { cookies } from 'next/headers'

export async function getContent() {
  const cookieStore = await cookies()
  const userRole = cookieStore.get('role')?.value

  if (userRole === 'admin') {
    // Don't cache admin content (changes frequently)
    return fetch('https://api.example.com/admin/content').then(r => r.json())
  }

  // Cache public content
  return getCachedPublicContent()
}

async function getCachedPublicContent() {
  'use cache'

  return fetch('https://api.example.com/public/content').then(r => r.json())
}

// ============================================================================
// Example 8: Inline "use cache" (Granular Control)
// ============================================================================

export async function MixedCachingComponent() {
  // This function call is cached
  const cachedData = await (async function() {
    'use cache'
    return fetch('https://api.example.com/slow-data').then(r => r.json())
  })()

  // This function call is NOT cached
  const freshData = await fetch('https://api.example.com/fresh-data').then(r => r.json())

  return (
    <div>
      <div>Cached: {cachedData.value}</div>
      <div>Fresh: {freshData.value}</div>
    </div>
  )
}

// ============================================================================
// Migration Guide: Next.js 15 → Next.js 16
// ============================================================================

// ❌ BEFORE (Next.js 15 - Implicit Caching):
/*
// All Server Components were cached by default
export async function MyComponent() {
  const data = await fetch('https://api.example.com/data')
  return <div>{data.value}</div>
}

// To opt-out of caching:
export const revalidate = 0 // or export const dynamic = 'force-dynamic'
*/

// ✅ AFTER (Next.js 16 - Explicit Opt-In Caching):
/*
// Components are NOT cached by default
export async function MyComponent() {
  const data = await fetch('https://api.example.com/data')
  return <div>{data.value}</div>
}

// To opt-IN to caching, add "use cache" inside the function
export async function MyCachedComponent() {
  'use cache'
  const data = await fetch('https://api.example.com/data')
  return <div>{data.value}</div>
}
*/

// ============================================================================
// Cache Behavior Summary
// ============================================================================

/**
 * "use cache" can be added to:
 * 1. ✅ Components (entire component cached)
 * 2. ✅ Functions (function output cached)
 * 3. ✅ Pages (entire page cached)
 * 4. ✅ Layouts (layout cached)
 * 5. ✅ Inline async functions (granular caching)
 * 6. ✅ File level (a top-of-file "use cache" caches ALL exports in that file)
 *
 * Default behavior (without "use cache"):
 * - Server Components: NOT cached (change from Next.js 15)
 * - fetch() calls: NOT cached by default either — caching is now OPT-IN.
 *   (Next.js 15 removed the implicit fetch cache. To cache a fetch, use a
 *   "use cache" scope, or set `cache: 'force-cache'` explicitly. The default
 *   is `no-store` / auto-no-cache.)
 *
 * Tagging & cache lifetime (both require `cacheComponents: true`):
 * - cacheTag('tag'): attach one or more tags to a cache entry for targeted
 *   invalidation (call inside a "use cache" scope).
 * - cacheLife('max' | 'default' | 'seconds:N'): set the cache lifetime/profile
 *   for a "use cache" scope.
 *
 * Revalidation:
 * - revalidateTag(tag, profile): invalidate by tag (2-arg form; stale-while-
 *   revalidate; single-arg form is deprecated in Next.js 16)
 * - updateTag(): immediate read-your-own-writes (Server Functions only)
 * - refresh(): refresh uncached data only
 *
 * When to use "use cache":
 * ✅ Expensive computations (database queries, API calls)
 * ✅ Stable data (product catalogs, blog posts)
 * ✅ Partial Prerendering (static header + dynamic user info)
 *
 * When NOT to use "use cache":
 * ❌ Real-time data (metrics, notifications)
 * ❌ User-specific data (unless using cookies/headers for cache keys)
 * ❌ Frequently changing data (stock prices, live scores)
 */
