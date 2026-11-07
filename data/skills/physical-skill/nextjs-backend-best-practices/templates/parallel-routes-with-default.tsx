/**
 * Next.js 16 — Parallel Routes with default.tsx
 *
 * Parallel routes let several routes render in the same layout as *slots*.
 * A slot is a folder prefixed with `@` (e.g. `@modal`, `@analytics`) whose
 * value is passed to the enclosing `layout.tsx` as a named prop:
 *
 *   app/layout.tsx              → { children, modal }
 *   app/dashboard/layout.tsx    → { children, analytics, notifications, activity }
 *
 * default.tsx — WHAT IT ACTUALLY DOES (read this, it is the #1 misconception):
 *   • It is a *fallback UI* for a slot that has no matched route content.
 *   • It is OPTIONAL, not a hard requirement. Next.js renders `null` when a slot
 *     is unmatched and no default.tsx exists.
 *   • It matters on HARD navigation — a full page load / refresh / deep link —
 *     when Next.js cannot recover the slot's *active state* (e.g. navigating
 *     directly to `/login`, which only the `@modal` slot matches). On SOFT
 *     navigation (an in-app `<Link>` click) the router already knows the slot's
 *     current state and does NOT need default.tsx.
 *   • If a slot route is genuinely unreachable on a hard load and there is no
 *     matching route AND the surrounding route cannot be resolved, the request
 *     can resolve to a 404. default.tsx is your way to avoid that by giving
 *     unmatched slots a defined render.
 *
 * So the rule of thumb is: use `@slot/default.tsx` whenever a slot should show
 * *something* (even `null`) on a hard navigation, instead of relying on default
 * null behaviour or hitting an unmatched route.
 *
 * IMPORTANT — THIS IS A MULTI-FILE TEACHING TEMPLATE
 *   Every snippet below is labelled `// File: <path>`. They are shown together
 *   for study, but each block belongs in its OWN file. In a real project:
 *     - imports/`'use client'` go at the TOP of the file that uses them, and
 *     - a slot's `default.tsx` MUST `export default` a React component.
 *   Do NOT paste all snippets into one .tsx — split them per the `// File:` paths.
 *
 * Example index:
 *   Example 1  Modal + Main Content ........ app/layout.tsx, app/@modal/*, app/default.tsx
 *   Example 2  Dashboard Panels ............ app/dashboard/{layout,@analytics,@notifications,@activity}
 *   Example 3  Product + Reviews .......... app/products/[id]/{layout,@reviews,@recommendations}
 *   Example 4  Auth-Gated Slot ............ app/@auth/*  (with caveats!)
 *   Example 5  Conditional Banner ......... app/@banner/*  (+ useSelectedLayoutSegments)
 *   Example 6  Loading States ............. @slot/loading.tsx
 *   Example 7  Error Boundaries ........... @slot/error.tsx
 *
 * Directory structure (Example 1 + 2 + 5):
 * app/
 * ├── @modal/
 * │   ├── login/
 * │   │   └── page.tsx     ← matched when navigating to /login
 * │   └── default.tsx      ← renders when no @modal route matches (e.g. /)
 * ├── @banner/
 * │   ├── sale/
 * │   │   └── page.tsx     ← matched on /sale
 * │   └── default.tsx      ← typically `return null` (no banner)
 * ├── dashboard/
 * │   ├── @analytics/default.tsx
 * │   ├── @notifications/default.tsx
 * │   ├── @activity/default.tsx
 * │   └── layout.tsx
 * ├── default.tsx          ← fallback for the implicit `children` slot (see Example 1)
 * └── layout.tsx           ← receives { children, modal, banner }
 */

// ============================================================================
// Example 1: Modal + Main Content (Common Pattern)
// ============================================================================

// File: app/layout.tsx
export default function RootLayout({
  children,
  modal,
  banner,
}: {
  children: React.ReactNode
  modal: React.ReactNode
  banner: React.ReactNode
}) {
  return (
    <html>
      <body>
        {banner}
        {modal}
        <main>{children}</main>
      </body>
    </html>
  )
}

// File: app/@modal/login/page.tsx
export default function LoginModal() {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Login</h2>
        <form>
          <input type="email" placeholder="Email" />
          <input type="password" placeholder="Password" />
          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  )
}

// File: app/@modal/default.tsx (fallback for the @modal slot)
export default function ModalDefault() {
  return null // No modal shown by default
}

// File: app/default.tsx
// The `children` slot is itself an implicit parallel slot. When a hard
// navigation targets a route that matches a parallel slot (e.g. `/login` →
// @modal) but has no page for `children`, `app/default.tsx` gives that slot a
// defined fallback so it doesn't resolve to a 404 on refresh/deep-link.
export default function RootDefault() {
  return null // or a lightweight fallback / skeleton
}

// File: app/page.tsx
// NOTE: use `next/link` for in-app navigation. A plain `<a href>` triggers a
// HARD navigation (full reload), which is exactly when slot state must be
// recovered via default.tsx. For the modal pattern you want a SOFT navigation,
// so always use <Link>.
import Link from 'next/link'

export default function HomePage() {
  return (
    <div>
      <h1>Home Page</h1>
      {/* Soft navigation — the modal slot is opened without a full reload. */}
      <Link href="/login">Open Login Modal</Link>
    </div>
  )
}

// ============================================================================
// Example 2: Dashboard with Multiple Panels
// ============================================================================

// File: app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
  analytics,
  notifications,
  activity,
}: {
  children: React.ReactNode
  analytics: React.ReactNode
  notifications: React.ReactNode
  activity: React.ReactNode
}) {
  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        {notifications}
      </aside>

      <main className="main-content">
        {children}
        {analytics}
      </main>

      <aside className="activity-sidebar">
        {activity}
      </aside>
    </div>
  )
}

// File: app/dashboard/@analytics/overview/page.tsx
export default async function AnalyticsOverview() {
  const res = await fetch('https://api.example.com/stats')
  if (!res.ok) {
    // Throw so the nearest error.tsx boundary (@analytics/error.tsx) handles it.
    throw new Error(`Failed to load analytics: ${res.status}`)
  }
  const stats: { pageViews: number; uniqueVisitors: number } = await res.json()

  return (
    <div className="analytics-panel">
      <h2>Analytics</h2>
      <div>
        <p>Page Views: {stats.pageViews}</p>
        <p>Unique Visitors: {stats.uniqueVisitors}</p>
      </div>
    </div>
  )
}

// File: app/dashboard/@analytics/default.tsx (fallback for the @analytics slot)
export default function AnalyticsDefault() {
  return (
    <div className="analytics-panel">
      <h2>Analytics</h2>
      <p>No analytics data available</p>
    </div>
  )
}

// File: app/dashboard/@notifications/default.tsx (fallback for the @notifications slot)
export default function NotificationsDefault() {
  return (
    <div className="notifications-panel">
      <h3>Notifications</h3>
      <p>No new notifications</p>
    </div>
  )
}

// File: app/dashboard/@activity/default.tsx (fallback for the @activity slot)
export default function ActivityDefault() {
  return (
    <div className="activity-panel">
      <h3>Recent Activity</h3>
      <p>No recent activity</p>
    </div>
  )
}

// ============================================================================
// Example 3: E-commerce with Product + Reviews
// ============================================================================

// File: app/products/[id]/layout.tsx
export default function ProductLayout({
  children,
  reviews,
  recommendations,
}: {
  children: React.ReactNode
  reviews: React.ReactNode
  recommendations: React.ReactNode
}) {
  return (
    <div className="product-layout">
      <div className="product-main">
        {children}
      </div>

      <div className="product-sidebar">
        {reviews}
        {recommendations}
      </div>
    </div>
  )
}

// File: app/products/[id]/@reviews/page.tsx
// Slots inherit the parent route's dynamic params, so `params` is typed as a
// Promise and MUST be awaited (Next.js 16 async params).
export default async function ProductReviews({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const res = await fetch(`https://api.example.com/products/${id}/reviews`)
  if (!res.ok) {
    throw new Error(`Failed to load reviews: ${res.status}`)
  }
  const reviews: { id: string; rating: number; comment: string }[] = await res.json()

  return (
    <div className="reviews">
      <h3>Reviews</h3>
      <ul>
        {reviews.map((review) => (
          <li key={review.id}>
            <p>⭐ {review.rating}/5</p>
            <p>{review.comment}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

// File: app/products/[id]/@reviews/default.tsx (fallback for the @reviews slot)
export default function ReviewsDefault() {
  return (
    <div className="reviews">
      <h3>Reviews</h3>
      <p>No reviews yet</p>
    </div>
  )
}

// File: app/products/[id]/@recommendations/default.tsx (fallback for the @recommendations slot)
// A default.tsx is a *fallback*, NOT a loading state — use loading.tsx for that
// (see Example 6). So show the empty/fallback copy here, not "Loading...".
export default function RecommendationsDefault() {
  return (
    <div className="recommendations">
      <h3>Recommendations</h3>
      <p>No recommendations available</p>
    </div>
  )
}

// ============================================================================
// Example 4: Auth-Gated Slot (with important caveats)
// ============================================================================
//
// ⚠️ CAVEAT: A slot's default.tsx renders for EVERY route under its layout that
// does not otherwise fill the slot — including public pages. Do NOT put a
// "redirect to /login if unauthenticated" gate in a slot default.tsx: that would
// bounce unauthenticated users away from your public pages on any hard load.
//
// Correct pattern: read cookies/authorize at the DATA layer (or in the specific
// page that needs it) and redirect THERE. The slot default below only renders a
// neutral fallback.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// File: app/@auth/default.tsx (fallback for the @auth slot)
// Renders nothing when no @auth route matches. No auth gate here.
export default function AuthDefault() {
  return null
}

// File: app/@auth/profile/page.tsx
// Auth is enforced in the specific page that requires it (or via a DAL helper),
// not in the slot default. This page redirects only itself when unauthenticated.
export default async function ProfilePage() {
  const cookieStore = await cookies()
  const userId = cookieStore.get('userId')?.value

  if (!userId) {
    // Only the protected page redirects — public pages are unaffected.
    redirect('/login')
  }

  const res = await fetch(`https://api.example.com/users/${userId}`)
  if (!res.ok) {
    throw new Error(`Failed to load profile: ${res.status}`)
  }
  const user: { name: string; email: string } = await res.json()

  return (
    <div>
      <h2>Profile</h2>
      <p>Name: {user.name}</p>
      <p>Email: {user.email}</p>
    </div>
  )
}

// ============================================================================
// Example 5: Conditional Rendering Based on Slot
// ============================================================================

// File: app/layout.tsx
// Use `useSelectedLayoutSegments` to decide which slot to show based on the
// current route, instead of a hard-coded flag. `useSelectedLayoutSegments` is a
// client hook, so the component using it must be a Client Component.
'use client'

import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'

export default function Layout({
  children,
  banner,
}: {
  children: React.ReactNode
  banner: React.ReactNode
}) {
  const segments = useSelectedLayoutSegments()

  // Show the banner only on the promo route, e.g. /sale
  const showBanner = segments.includes('sale')

  return (
    <html>
      <body>
        {showBanner ? banner : null}
        <main>{children}</main>
        <nav>
          <Link href="/sale">Sale</Link>
        </nav>
      </body>
    </html>
  )
}

// File: app/@banner/sale/page.tsx
export default function SaleBanner() {
  return (
    <div className="banner sale-banner">
      🎉 50% OFF SALE! Use code SALE50
    </div>
  )
}

// File: app/@banner/default.tsx (fallback for the @banner slot)
export default function BannerDefault() {
  return null // No banner by default
}

// ============================================================================
// Example 6: Loading States with Parallel Routes
// ============================================================================

// File: app/dashboard/@analytics/loading.tsx
export default function AnalyticsLoading() {
  return (
    <div className="analytics-panel">
      <h2>Analytics</h2>
      <p>Loading analytics...</p>
      <div className="skeleton-loader" />
    </div>
  )
}

// File: app/dashboard/@notifications/loading.tsx
export default function NotificationsLoading() {
  return (
    <div className="notifications-panel">
      <h3>Notifications</h3>
      <div className="skeleton-loader" />
    </div>
  )
}

// ============================================================================
// Example 7: Error Boundaries with Parallel Routes
// ============================================================================

// File: app/dashboard/@analytics/error.tsx
// Error boundaries are Client Components — this directive belongs at the TOP of
// THIS file (shown here above its own snippet). Each File: block is separate.
'use client'

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="analytics-panel error">
      <h2>Analytics</h2>
      <p>Failed to load analytics</p>
      <button onClick={reset}>Try Again</button>
    </div>
  )
}

// ============================================================================
// Migration notes: default.tsx in Next.js 15 vs 16
// ============================================================================

/**
 * default.tsx behaviour — the accurate picture
 *
 * Next.js 15 / 16 (same behaviour):
 *   app/
 *   ├── @modal/
 *   │   ├── login/
 *   │   │   └── page.tsx
 *   │   └── default.tsx    ← add this when the slot should render a fallback
 *   └── layout.tsx
 *
 * Why you add default.tsx:
 *   On a HARD navigation (full reload / deep link / refresh) the router can't
 *   reuse the slot's in-memory state, so it re-resolves the slot for the current
 *   URL. If nothing matches the slot for that URL, default.tsx is what renders.
 *   Without it, the slot simply renders `null` — and for a route that the slot
 *   is expected to own (e.g. `/login` → @modal), an unmatched slot on a hard load
 *   can surface as a 404. On SOFT navigation (an in-app <Link>), the router
 *   already knows the slot's active state and default.tsx is not consulted.
 *
 * What should default.tsx return?
 *   - return null            (most common — render nothing)
 *   - return <Skeleton />    (a lightweight placeholder, NOT a network loading state)
 *   - redirect() to another route (use sparingly — see Example 4 caveat)
 *   - return fallback UI     (empty-state message)
 *
 * NOTE: default.tsx is NOT a replacement for loading.tsx. loading.tsx covers
 * in-flight Suspense/streaming; default.tsx covers *unmatched* slots.
 */

// ============================================================================
// Common Patterns for default.tsx
// ============================================================================
// Each pattern is a real `app/@slot/default.tsx` — a default export is REQUIRED,
// because the App Router renders the file's DEFAULT export as the slot content.

// File: app/@slot/default.tsx — Pattern 1: null (no UI)
export default function DefaultNull() {
  return null
}

// File: app/@slot/default.tsx — Pattern 2: loading skeleton placeholder
export default function DefaultSkeleton() {
  return (
    <div className="skeleton">
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
    </div>
  )
}

// File: app/@slot/default.tsx — Pattern 3: fallback message
export default function DefaultFallback() {
  return (
    <div>
      <p>Content not available</p>
    </div>
  )
}

// File: app/@slot/default.tsx — Pattern 4: redirect
import { redirect } from 'next/navigation'

export default function DefaultRedirect() {
  redirect('/dashboard')
}

/**
 * Summary
 *
 * Parallel Routes in Next.js 16:
 * 1. ✅ Use `@folder` convention for parallel slots
 * 2. ✅ Add `default.tsx` to each `@folder` so unmatched slots have a fallback
 *       (it renders on hard navigation; soft navigation keeps slot state)
 * 3. ✅ The `children` slot is implicit — `app/default.tsx` is its fallback
 * 4. ✅ `loading.tsx` handles in-flight/loading states (separate from default.tsx)
 * 5. ✅ `error.tsx` handles errors (Client Component, `'use client'` at top)
 *
 * Common use cases:
 * - Modals + main content
 * - Dashboard panels
 * - Product + reviews/recommendations
 * - Conditional banners
 * - Auth-gated content (gate at the data/page layer, not in slot default.tsx)
 *
 * Best practices:
 * - Keep default.tsx simple (usually `return null`)
 * - Use `next/link` <Link> for in-app navigation so slots use soft navigation
 * - Use loading.tsx for better UX
 * - Use error.tsx for error handling
 * - Test both soft navigation (client-side) and hard navigation (refresh/deep-link)
 */
