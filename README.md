# StoryMania

Type a topic, get a 5-page illustrated story — narrated aloud, page-by-page, in your browser.

Built on Next.js 14 with OpenRouter for both story text (LLM) and per-page illustrations (image-output model). Voice narration is browser-native; auto-advances when each page finishes.

## Quickstart

```bash
npm install
cp .env.local.example .env.local       # then fill in OPENROUTER_API_KEY
npm run dev                             # http://localhost:3005
```

You only need one secret: an [OpenRouter API key](https://openrouter.ai/keys). The same key powers story text and image generation.

## Features

- **Prompt → 5-page story** in ~60 seconds. Each page has a title, ≤50-word body, and a generated illustration.
- **Voice narration** via the browser's Web Speech API (no API call, no cost). The current word is highlighted as it's spoken; auto-advances to the next page when the current one finishes. Pause / Resume / mute controls in the story header.
- **Refresh-safe** — the current story (and your current page) is persisted in IndexedDB. Reload the tab and pick up where you left off.
- **Save as PDF** — one-click download of the full story with embedded illustrations (A4, client-side via jsPDF).
- **Graceful fallbacks** — if any image fails to generate or load, the page shows a placeholder instead of a broken icon.

## Configuration

All env vars live in `.env.local`. See `.env.local.example` for the full list.

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | Yes | — | Used for both text and image generation. |
| `OPENROUTER_MODEL` | No | `openai/gpt-4o-mini` | LLM for the 5-page story. |
| `OPENROUTER_IMAGE_MODEL` | No | `google/gemini-2.5-flash-image` | Must support image output. Browse: [openrouter.ai/models](https://openrouter.ai/models?fmt=cards&output_modalities=image). |
| `OPENROUTER_APP_NAME` | No | `Storymenia` | Shown in OpenRouter's request log. |

Image gen costs roughly $0.04/image on Gemini Flash Image → ~$0.20 per 5-page story. Use a `:free` variant for testing.

## Stack

- Next.js 14 (App Router) · React 18 · TypeScript
- OpenRouter (text + image) · Web Speech API (TTS)
- IndexedDB (current-story persistence) · jsPDF (PDF export)
- CSS Modules

## Project layout

```
app/
  api/story/route.ts    POST /api/story — generates story + images
  page.tsx              Single-page UI: prompt → loading → story
  storyDb.ts            IndexedDB wrapper for persisting the current story
  storyPdf.ts           jsPDF-based "Save as PDF" exporter
  types.ts              Shared Story / StoryPage types
  layout.tsx            HTML shell + metadata
  globals.css           Theme variables
  page.module.css       Page styles
```

Dev server runs on port **3005** (not the Next.js default).

## Notes

- No tests, no database, no auth. This is a tiny single-user app.
- Stories vanish when you click "New story" (the IndexedDB record is cleared). Generating a new story replaces the old one — there is no library/history view by design.
- Voice quality depends on your OS's built-in TTS voices. Chrome on Windows ships nice ones; Safari uses macOS voices.

For deeper architecture notes (intentional design quirks, failure modes, the OpenRouter image-response shapes), see [`storymaker.md`](./storymaker.md).
