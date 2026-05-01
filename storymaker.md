# storymaker.md

Project guide for the **Storymenia** / **StoryMania** app — a tiny Next.js single-page app that turns a topic into a 5-page illustrated story.

## Commands

```bash
npm install
npm run dev      # next dev -p 3005 — http://localhost:3005
npm run build    # next build
npm run start    # next start -p 3005
npm run lint     # next lint
```

Port is **3005** (not the Next.js default 3000) — see `package.json`.

## Required setup

Copy `.env.local.example` → `.env.local` and fill in:

- `OPENROUTER_API_KEY` — **required**. One key powers both story text and image generation.
- `OPENROUTER_MODEL` — optional. LLM for story prose. Default: `openai/gpt-4o-mini`.
- `OPENROUTER_IMAGE_MODEL` — optional. Must be an image-output-capable model. Default: `google/gemini-2.5-flash-image` (paid, ~$0.039/image). Use the `:free` variant for testing.
- `OPENROUTER_APP_NAME` — optional. Shown on OpenRouter's request log.

If `OPENROUTER_API_KEY` is missing the API route returns 500 with a clear error. Image failures degrade gracefully — see "Failure modes" below.

## Stack

- Next.js 14 (App Router), React 18, TypeScript (strict)
- No database, no auth, no external file storage
- CSS Modules (`page.module.css`) + global theme variables in `app/globals.css`

## Architecture

The whole app is **one page + one API route**. Don't expect routing — there isn't any.

```
app/page.tsx              "use client" SPA — three views (idle / loading / story)
app/page.module.css       page styles
app/layout.tsx            <html>/<body> shell + metadata
app/globals.css           theme variables (--bg, --accent, etc.)
app/types.ts              shared Story / StoryPage / GenerateResponse types
app/storyDb.ts            IndexedDB wrapper for persisting the current story
app/storyPdf.ts           jsPDF-based "Save as PDF" exporter (client-only)
app/api/story/route.ts    POST endpoint: prompt → 5 pages with images
```

### Frontend state machine (`app/page.tsx`)

A single `view: "idle" | "loading" | "story"` drives the render — there's no router, no shared store. The current story (and current page index) is persisted to **IndexedDB** so refresh restores you to the page you were on.

- `idle`: prompt textarea + suggestion chips
- `loading`: spinner with copy "this takes about a minute"
- `story`: paginated viewer with prev/next nav and dot indicators; "New story" button calls `reset()` to go back to `idle` (which clears the IDB record via the persistence effect)

A `hydrated` flag gates the first paint: until `loadCurrentStory()` resolves, the page renders an empty `<main>` to avoid flashing the prompt screen when a saved story is about to be restored. The voice-narration `useEffect` re-fires naturally after restore, so the saved page resumes narrating on reload.

The story view shows the site name "**StoryMania**" above the story title — see [app/page.tsx:77](C:/Claude-Test/storymaker/app/page.tsx:77). The eyebrow tag on the prompt screen still says "Storymenia" — these are intentionally separate brand strings, **don't normalize them without asking**.

### API route (`app/api/story/route.ts`)

`POST /api/story` with `{ prompt: string }` → `GenerateResponse`. The route does two things sequentially:

1. **Story text** via `generateStoryText()` — calls `https://openrouter.ai/api/v1/chat/completions` with `response_format: { type: "json_object" }`, parses with `extractJson()` (which strips ``` fences if present), then runtime-validates against `isRawStory()` (must be exactly 5 pages, each with title/body/imagePrompt). The model is **prompted to never include text in image prompts** — keep that constraint if editing the system prompt.
2. **Images** via `generateOpenRouterImage()` — fired in parallel with `Promise.allSettled` for all 5 pages. Same OpenRouter endpoint, but with `modalities: ["image", "text"]` and an image-capable model. Response is parsed for **two possible shapes**: `message.images[].image_url.url` (Gemini-style) or `message.content[].image_url.url` (OpenAI-style content array). Returns a base64 `data:image/...;base64,...` URI inline — no second HTTP fetch from the client.

`maxDuration = 120` is set on the route — image generation can be slow on the free tier.

### Failure modes (deliberate, worth keeping)

- If story generation fails → 502 with the upstream error message in the body.
- If a single image fails → that page's `imageUrl` is `null` and the UI shows the "Illustration unavailable" placeholder.
- If an image URL **loads** but the request 404s/errors in the browser → the `<img onError>` handler in [app/page.tsx](C:/Claude-Test/storymaker/app/page.tsx) hides the broken `<img>` and reveals a sibling placeholder div. This double layer (server null + client onError) is intentional; don't collapse it.

## Conventions

- API route uses `export const dynamic = "force-dynamic"` — keep this; story responses are unique per request.
- Path alias `@/*` is **not configured** here (unlike sibling projects) — use relative imports (`../../types`).
- The system prompt in `route.ts` is the single source of truth for story shape. If you change page count or fields, update `isRawStory()`, `RawStory` type, and `StoryPage` in [app/types.ts](C:/Claude-Test/storymaker/app/types.ts) together.
- No tests configured. Manual test = run `npm run dev`, paste a topic, wait ~60s.

## Things that look weird but are intentional

- **IndexedDB, not localStorage**, for the saved story. A 5-page story embeds 5 base64 PNG data URIs (~2–6MB total) — Safari's ~5MB localStorage cap would risk `QuotaExceededError` on first save. IndexedDB has multi-GB quotas. Persistence is best-effort: every helper in `app/storyDb.ts` wraps in try/catch so a quota or private-mode failure can never crash the UI.
- **Only the *current* story persists** — generating a new one overwrites it; clicking "New story" clears it. There is no library/history view by design (user explicitly chose this scope).
- **`voiceOn` and the prompt textarea draft are NOT persisted.** Voice on/off is a session-level UI preference; the prompt is ephemeral. Don't add persistence for either without asking.
- **Two brand names** ("Storymenia" in metadata/eyebrow, "StoryMania" above the story title). Treat as a deliberate split, not a typo.
- **Image gen via chat-completions, not a dedicated /images endpoint.** OpenRouter doesn't expose a unified images API; routing through chat-completions with `modalities` is the supported pattern.
