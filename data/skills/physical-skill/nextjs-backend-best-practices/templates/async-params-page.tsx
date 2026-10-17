/**
 * Next.js 16 - Async Params Page Template
 * 
 * BREAKING CHANGE: In Next.js 16, params and searchParams are now async.
 * This template shows the correct pattern for Next.js 16+.
 */

import { Metadata } from 'next'
import { notFound } from 'next/navigation'

/**
 * Shared fetch helper with defensive response handling.
 *
 * WHY defensive parsing:
 * - `fetch` only rejects on network errors; a 404/500 still resolves.
 * - `r.json()` throws on non-JSON bodies (e.g. HTML error pages).
 * - The upstream API may return a bare object instead of an array.
 * Centralizing the guard keeps every caller (page / metadata / static params)
 * consistent and prevents build-time crashes.
 */
async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url)
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

interface Post {
  title: string
  content: string
  excerpt?: string
  coverImage?: string
}

/**
 * Page Component with Async Params
 * 
 * IMPORTANT: 
 * - params is now Promise<{ id: string }>
 * - searchParams is now Promise<{ query: string }>
 * - Component must be async
 */
export default async function PostPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ query?: string }>
}) {
  // 1. Await params (REQUIRED in Next.js 16)
  const { id } = await params
  
  // 2. Await searchParams (REQUIRED in Next.js 16)
  // searchParams is always a Promise object (never undefined) in App Router,
  // but the awaited value may be an empty object when no query is present.
  const { query } = (await searchParams) ?? {}
  
  // 3. Fetch data (runs on server) — guard against failure / non-JSON bodies
  const post = await fetchJson<Post | null>(
    `https://api.example.com/posts/${id}`,
    null
  )
  
  // 4. Handle not found — explicit `return` so TypeScript narrows `post`
  //    to non-null for the rest of the function (notFound() is typed `never`).
  if (!post) {
    return notFound()
  }
  
  // 5. Render
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
      {query && <p>Search query: {query}</p>}
    </article>
  )
}

/**
 * Generate Metadata (also async in Next.js 16)
 */
export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  // Await params
  const { id } = await params
  
  // Fetch data — same defensive helper as the page component
  const post = await fetchJson<Post | null>(
    `https://api.example.com/posts/${id}`,
    null
  )
  
  if (!post) {
    return {
      title: 'Post Not Found'
    }
  }
  
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      // Only include images when coverImage exists — otherwise Next.js would
      // emit `images: [undefined]` (an invalid OG image entry).
      images: post.coverImage ? [post.coverImage] : undefined
    }
  }
}

/**
 * Generate Static Params (for static generation)
 *
 * WHY the guard matters: `generateStaticParams` runs at build time. If the
 * fetch fails or the API returns a non-array payload, calling `.map` on it
 * throws a TypeError and aborts `next build`. We therefore validate the shape
 * and degrade gracefully (an empty list = no prerendered paths, dynamic
 * fallback still works) instead of breaking the build.
 */
export async function generateStaticParams() {
  // Fetch all post IDs (empty array fallback keeps the build alive)
  const posts = await fetchJson<Array<{ id: string }>>(
    'https://api.example.com/posts',
    []
  )
  
  // Guard against a non-array/empty response before mapping
  if (!Array.isArray(posts)) {
    return []
  }
  
  // Return array of params
  return posts.map((post) => ({
    id: post.id
  }))
}

/**
 * Configure dynamic behavior
 *
 * NOTE: `force-static` is shown here for the common static-blog case. If you
 * rely on `searchParams` at request time, use `force-dynamic` (or remove the
 * export) — reading searchParams while fully static is a semantic mismatch.
 */
export const dynamic = 'force-static' // or 'force-dynamic' when reading searchParams per-request
export const revalidate = 3600 // Revalidate every hour

/**
 * Layout Component with Async Params
 * 
 * File: app/posts/[id]/layout.tsx
 */
/*
export default async function PostLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  
  return (
    <div>
      <header>Post {id}</header>
      {children}
    </div>
  )
}
*/

/**
 * Nested Dynamic Routes
 * 
 * File: app/posts/[id]/comments/[commentId]/page.tsx
 */
/*
export default async function CommentPage({
  params
}: {
  params: Promise<{ id: string; commentId: string }>
}) {
  const { id, commentId } = await params
  
  return (
    <div>
      <p>Post ID: {id}</p>
      <p>Comment ID: {commentId}</p>
    </div>
  )
}
*/

/**
 * Migration Notes:
 * 
 * Next.js 15 (OLD):
 * - params: { id: string }
 * - searchParams: { query: string }
 * - cookies() - synchronous
 * - headers() - synchronous
 * 
 * Next.js 16 (NEW):
 * - params: Promise<{ id: string }>
 * - searchParams: Promise<{ query: string }>
 * - await cookies() - async
 * - await headers() - async
 * 
 * Codemod:
 * npx @next/codemod@canary upgrade latest
 */
