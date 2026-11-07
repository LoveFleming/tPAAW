/**
 * Next.js 16 - Server Actions for Form Handling
 *
 * This template shows comprehensive Server Actions patterns including:
 * - Basic form handling
 * - Validation with Zod
 * - Loading states (useActionState + useFormStatus)
 * - Error handling (return errors, aria-invalid / aria-describedby / role="alert")
 * - Optimistic updates (useOptimistic inside startTransition)
 * - File uploads (with filename sanitization)
 * - Rate limiting (with expired-key pruning)
 *
 * ⚠️ IMPORTANT — every example below belongs to a DIFFERENT file:
 *   - Server Actions live in files like app/posts/actions.ts and must have
 *     'use server' as the FIRST line of that file.
 *   - Client components live in their own *.tsx files and must have
 *     'use client' as the FIRST line of that file.
 * Next.js allows AT MOST ONE module-level directive per file, so a real
 * project never mixes them. This reference file therefore carries NO
 * directive at all — when you copy an example, add the directive noted in
 * its `File:` header comment.
 *
 * For the same reason, all imports are grouped at the top of this file.
 * When copying an example, take only the imports that file needs.
 */

// --- imports for the 'use server' action files -----------------------------
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { writeFile } from 'fs/promises'
import { join } from 'path'

// --- imports for the 'use client' component files ---------------------------
import { useActionState, useOptimistic, useState, startTransition } from 'react'
import { useFormStatus } from 'react-dom'
import Image from 'next/image'

// ============================================================================
// Example 1: Basic Server Action
// File: app/posts/actions.ts  →  add 'use server' as the first line
// ============================================================================

export async function createPost(formData: FormData) {
  // Coerce with String() instead of `as string` — a null/absent field would
  // otherwise slip through the cast and post "null" to your API.
  const title = String(formData.get('title') ?? '')
  const content = String(formData.get('content') ?? '')

  // Save to database. fetch only rejects on network errors — a 4xx/5xx
  // response still resolves, so ALWAYS check res.ok before treating the
  // call as successful.
  const res = await fetch('https://api.example.com/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  })
  if (!res.ok) {
    throw new Error(`Failed to create post (HTTP ${res.status})`)
  }

  // Revalidate cache — Next.js 16 form: tag + cache profile
  revalidateTag('posts', 'max')

  // Redirect AFTER the action succeeds.
  // NOTE: redirect() throws internally (NEXT_REDIRECT) — keep it outside
  // try/catch blocks, or catch and re-throw non-redirect errors only.
  redirect('/posts')
}

// Basic form component
// File: app/posts/CreatePostForm.tsx  →  add 'use client' as the first line

export function CreatePostForm() {
  return (
    <form action={createPost}>
      <label htmlFor="title">Title:</label>
      <input id="title" type="text" name="title" required />

      <label htmlFor="content">Content:</label>
      <textarea id="content" name="content" required />

      <button type="submit">Create Post</button>
    </form>
  )
}

// ============================================================================
// Example 2: Server Action with Validation (Zod + useActionState)
// File: app/posts/actions.ts  →  add 'use server' as the first line
// ============================================================================

const PostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  content: z.string().min(10, 'Content must be at least 10 characters'),
  tags: z.array(z.string()).min(1, 'At least one tag is required'),
})

type ActionState = {
  errors?: {
    title?: string[]
    content?: string[]
    tags?: string[]
    _form?: string[]
  }
  success?: boolean
}

export async function createPostWithValidation(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Parse form data
  const rawData = {
    title: formData.get('title'),
    content: formData.get('content'),
    tags: formData.get('tags')?.toString().split(',') || [],
  }

  // Validate on the server — never trust client input
  const parsed = PostSchema.safeParse(rawData)

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
    }
  }

  // Save to database
  try {
    const res = await fetch('https://api.example.com/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    })

    // A failed HTTP call is NOT a network error — check res.ok and surface
    // it as a form-level error instead of silently "succeeding".
    if (!res.ok) {
      return {
        errors: {
          _form: [`Failed to create post (HTTP ${res.status}). Please try again.`],
        },
      }
    }

    revalidateTag('posts', 'max')

    return { success: true }
  } catch {
    // Network / unexpected errors → form-level error message
    return {
      errors: {
        _form: ['Failed to create post. Please try again.'],
      },
    }
  }
}

// Form with validation errors
// File: app/posts/ValidatedPostForm.tsx  →  add 'use client' as the first line
//
// React 19 / Next.js 16: use useActionState (from 'react').
// The old useFormState (from 'react-dom') has been REMOVED in React 19.

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Creating...' : 'Create Post'}
    </button>
  )
}

export function ValidatedPostForm() {
  const [state, formAction] = useActionState(createPostWithValidation, {})

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="title">Title:</label>
        <input
          id="title"
          type="text"
          name="title"
          required
          aria-invalid={state.errors?.title ? true : undefined}
          aria-describedby={state.errors?.title ? 'title-error' : undefined}
        />
        {state.errors?.title && (
          <p id="title-error" className="error">
            {state.errors.title[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="content">Content:</label>
        <textarea
          id="content"
          name="content"
          required
          aria-invalid={state.errors?.content ? true : undefined}
          aria-describedby={state.errors?.content ? 'content-error' : undefined}
        />
        {state.errors?.content && (
          <p id="content-error" className="error">
            {state.errors.content[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="tags">Tags (comma-separated):</label>
        <input
          id="tags"
          type="text"
          name="tags"
          placeholder="nextjs, react, tutorial"
          aria-invalid={state.errors?.tags ? true : undefined}
          aria-describedby={state.errors?.tags ? 'tags-error' : undefined}
        />
        {state.errors?.tags && (
          <p id="tags-error" className="error">
            {state.errors.tags[0]}
          </p>
        )}
      </div>

      {/* Form-level errors are announced assertively to screen readers */}
      {state.errors?._form && (
        <p role="alert" className="error">
          {state.errors._form[0]}
        </p>
      )}

      <SubmitButton />

      {state.success && <p role="status">Post created!</p>}
    </form>
  )
}

// ============================================================================
// Example 3: Server Action with Optimistic Updates
// File: app/posts/actions.ts  →  add 'use server' as the first line
// ============================================================================

export async function likePost(postId: string) {
  const res = await fetch(`https://api.example.com/posts/${postId}/like`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error(`Failed to like post (HTTP ${res.status})`)
  }

  revalidateTag('posts', 'max')
}

// Client component with optimistic updates
// File: app/posts/LikeButton.tsx  →  add 'use client' as the first line

export function LikeButton({ postId, initialLikes }: { postId: string; initialLikes: number }) {
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    initialLikes,
    (state, amount: number) => state + amount
  )

  function handleLike() {
    // Optimistic updates MUST run inside a transition (a form action or
    // startTransition). Outside one, useOptimistic never reverts to the real
    // state when the server action fails or resolves.
    startTransition(async () => {
      addOptimisticLike(1) // Update UI immediately
      await likePost(postId) // Sync with server
    })
  }

  return (
    <button onClick={handleLike}>
      ❤️ {optimisticLikes} likes
    </button>
  )
}

// ============================================================================
// Example 4: Server Action with File Upload
// File: app/uploads/actions.ts  →  add 'use server' as the first line
// ============================================================================

export async function uploadImage(formData: FormData) {
  const file = formData.get('image')

  // instanceof beats a truthiness check: formData.get() returns
  // File | string | null, and a plain string would pass `if (!file)`.
  if (!(file instanceof File)) {
    return { error: 'No file provided' }
  }

  // Validate file type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!validTypes.includes(file.type)) {
    return { error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' }
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024 // 5MB
  if (file.size > maxSize) {
    return { error: 'File too large. Maximum size is 5MB.' }
  }

  // Sanitize the filename BEFORE using it in a path. A crafted client can
  // send any name (`../../evil.png`), so: strip the directory component,
  // then whitelist characters. Without this, joining the raw name into a
  // filesystem path is a path-traversal (arbitrary write) vulnerability.
  const rawName = file.name.split(/[\\/]/).pop() ?? 'upload'
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filename = `${Date.now()}-${safeName}`
  const path = join(process.cwd(), 'public', 'uploads', filename)

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  await writeFile(path, buffer)

  return {
    success: true,
    url: `/uploads/${filename}`,
  }
}

// File upload form
// File: app/uploads/ImageUploadForm.tsx  →  add 'use client' as the first line

export function ImageUploadForm() {
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    const result = await uploadImage(formData)

    if (result.error) {
      setError(result.error)
    } else if (result.url) {
      setPreview(result.url)
      setError(null)
    }
  }

  return (
    <form action={handleSubmit}>
      <label htmlFor="image">Image (JPEG / PNG / WebP, max 5MB):</label>
      <input
        id="image"
        type="file"
        name="image"
        accept="image/jpeg,image/png,image/webp"
        required
      />

      <button type="submit">Upload Image</button>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {preview && (
        <div>
          <h3>Uploaded Image:</h3>
          {/* Use next/image instead of a raw <img>, and always provide BOTH
              width and height so the browser reserves layout space (no CLS).
              `unoptimized` skips the image optimizer for runtime-uploaded
              files it does not know about (alternatively configure
              images.remotePatterns or serve from a known host). */}
          <Image src={preview} alt="Uploaded preview" width={300} height={200} unoptimized />
        </div>
      )}
    </form>
  )
}

// ============================================================================
// Example 5: Server Action with Progressive Enhancement
// File: app/subscribe/actions.ts  →  add 'use server' as the first line
// ============================================================================

export async function subscribe(formData: FormData) {
  const email = String(formData.get('email') ?? '')

  const res = await fetch('https://api.example.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!res.ok) {
    return { success: false, message: `Subscription failed (HTTP ${res.status}).` }
  }

  return { success: true, message: 'Subscribed successfully!' }
}

// Form works without JavaScript (progressive enhancement)
// File: app/subscribe/SubscribeForm.tsx  →  no directive needed (server
// component) — only add 'use client' if it needs hooks/interactivity.
//
// Passing the action directly to <form action={...}> means the form submits
// even before any JavaScript hydrates.
export function SubscribeForm() {
  return (
    <form action={subscribe}>
      <label htmlFor="subscribe-email">Email:</label>
      <input
        id="subscribe-email"
        type="email"
        name="email"
        placeholder="Enter your email"
        required
      />
      <button type="submit">Subscribe</button>
    </form>
  )
}

// Enhanced with JavaScript: pending state + inline result message
// File: app/subscribe/EnhancedSubscribeForm.tsx  →  add 'use client' first line

export function EnhancedSubscribeForm() {
  // React 19: useActionState replaces the removed useFormState
  const [state, formAction] = useActionState(subscribe, null)

  return (
    <form action={formAction}>
      <label htmlFor="enhanced-subscribe-email">Email:</label>
      <input
        id="enhanced-subscribe-email"
        type="email"
        name="email"
        placeholder="Enter your email"
        required
      />
      <button type="submit">Subscribe</button>

      {state && (
        <p role="status" className={state.success ? 'success' : 'error'}>
          {state.message}
        </p>
      )}
    </form>
  )
}

// ============================================================================
// Example 6: Server Action with Multi-Step Form
// File: app/contact/actions.ts  →  add 'use server' as the first line
// ============================================================================

type Step1Data = { name: string; email: string }
type Step2Data = { address: string; city: string }
// NOTE: do NOT name this type `FormData` — it would shadow the DOM's global
// FormData type and break formData.get() typing for the whole module.
type MultiStepFormData = Step1Data & Step2Data

export async function submitMultiStepForm(data: MultiStepFormData) {
  // Validate all data
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    address: z.string().min(5),
    city: z.string().min(2),
  })

  const parsed = schema.safeParse(data)

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
    }
  }

  // Save to database
  const res = await fetch('https://api.example.com/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })

  if (!res.ok) {
    return { error: `Failed to submit (HTTP ${res.status}). Please try again.` }
  }

  return { success: true }
}

// Multi-step form component
// File: app/contact/MultiStepForm.tsx  →  add 'use client' as the first line

export function MultiStepForm() {
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<Partial<MultiStepFormData>>({})
  // Surface the outcome in-page instead of a blocking browser dialog —
  // status messages belong in the DOM (and role="status" announces them
  // politely to assistive tech).
  const [status, setStatus] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (step === 1) {
      const form = e.currentTarget
      setFormData({
        ...formData,
        name: (form.elements.namedItem('name') as HTMLInputElement).value,
        email: (form.elements.namedItem('email') as HTMLInputElement).value,
      })
      setStep(2)
    } else {
      const form = e.currentTarget
      const finalData = {
        ...formData,
        address: (form.elements.namedItem('address') as HTMLInputElement).value,
        city: (form.elements.namedItem('city') as HTMLInputElement).value,
      } as MultiStepFormData

      const result = await submitMultiStepForm(finalData)

      setStatus(
        result.success
          ? 'Form submitted successfully!'
          : result.error ?? 'Submission failed. Please try again.'
      )
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {step === 1 && (
        <>
          <h2>Step 1: Personal Info</h2>
          <label htmlFor="ms-name">Name:</label>
          <input id="ms-name" name="name" placeholder="Name" defaultValue={formData.name} required />
          <label htmlFor="ms-email">Email:</label>
          <input id="ms-email" name="email" type="email" placeholder="Email" defaultValue={formData.email} required />
          <button type="submit">Next</button>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Step 2: Address</h2>
          <label htmlFor="ms-address">Address:</label>
          <input id="ms-address" name="address" placeholder="Address" defaultValue={formData.address} required />
          <label htmlFor="ms-city">City:</label>
          <input id="ms-city" name="city" placeholder="City" defaultValue={formData.city} required />
          <button type="button" onClick={() => setStep(1)}>Back</button>
          <button type="submit">Submit</button>
        </>
      )}

      {status && <p role="status">{status}</p>}
    </form>
  )
}

// ============================================================================
// Example 7: Server Action with Rate Limiting
// File: app/contact/actions.ts  →  add 'use server' as the first line
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 5 // requests per window

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export async function submitContactForm(formData: FormData) {
  // Next.js 16: headers() is async — await it
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || 'unknown'

  const now = Date.now()
  const rateLimit = rateLimitMap.get(ip)

  if (rateLimit) {
    if (now < rateLimit.resetAt) {
      if (rateLimit.count >= RATE_LIMIT_MAX) {
        return { error: 'Too many requests. Please try again later.' }
      }
      rateLimit.count++
    } else {
      // Window expired — start a fresh one
      rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    }
  } else {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
  }

  // Prune EXPIRED entries so the Map cannot grow without bound. Without this
  // sweep, every unique IP address leaks an entry forever (unbounded memory
  // growth on a long-running server). (In multi-instance deployments, use a
  // shared store like Redis instead of an in-memory Map.)
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(key)
    }
  }

  // Process form
  const name = String(formData.get('name') ?? '')
  const message = String(formData.get('message') ?? '')

  const res = await fetch('https://api.example.com/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, message }),
  })

  if (!res.ok) {
    return { error: `Failed to send message (HTTP ${res.status}).` }
  }

  return { success: true }
}

/**
 * Summary:
 *
 * Server Actions patterns:
 * 1. ✅ Basic form handling with formData
 * 2. ✅ Validation with Zod (safeParse) — server-side, never trust the client
 * 3. ✅ Loading states with useFormStatus
 * 4. ✅ Error handling with useActionState (React 19; useFormState is gone)
 * 5. ✅ Optimistic updates with useOptimistic inside startTransition
 * 6. ✅ File uploads (type/size checks + filename sanitization)
 * 7. ✅ Progressive enhancement (form action works without JS)
 * 8. ✅ Multi-step forms (typed via MultiStepFormData, not a FormData alias)
 * 9. ✅ Rate limiting with expired-key pruning
 *
 * Best practices:
 * - Always validate on server (never trust client input)
 * - Check res.ok on every fetch — HTTP errors do not throw
 * - Use revalidateTag(tag, profile) for background revalidation (Next.js 16)
 * - Use updateTag() for immediate refresh (forms, settings)
 * - Return errors instead of throwing (better UX)
 * - One module-level directive ('use server' / 'use client') per file — never mix
 * - Group imports at the top of the file
 * - Use next/image (with width + height) instead of raw <img>
 * - Sanitize uploaded filenames before joining them into paths
 * - Link error messages to fields (aria-describedby / aria-invalid / role="alert")
 * - Add rate limiting for public forms
 */
