import { NextRequest, NextResponse } from "next/server";
import type { GenerateResponse, Story, StoryPage } from "../../types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are a creative storyteller and a visual director. Given a topic, write a vivid 5-page story AND describe a single illustration for each page.

Output ONLY a single JSON object with this exact shape — no markdown fences, no commentary:

{
  "title": "the story's title (under 80 characters)",
  "pages": [
    {
      "title": "page 1 title (under 60 chars)",
      "body": "page 1 narrative — at most 50 words, 1 to 3 short sentences",
      "imagePrompt": "a single rich visual description for this page's illustration"
    },
    { "title": "...", "body": "...", "imagePrompt": "..." },
    { "title": "...", "body": "...", "imagePrompt": "..." },
    { "title": "...", "body": "...", "imagePrompt": "..." },
    { "title": "...", "body": "...", "imagePrompt": "..." }
  ]
}

Rules:
- Exactly 5 pages.
- HARD LIMIT: each page body must be 50 words or fewer (1 to 3 short sentences). Be punchy, not verbose.
- Pages flow as one continuous story with a clear arc: setup, rising action, climax, falling action, resolution.
- Use sensory detail. Show, don't tell.
- Do not number page titles ("Page 1:" etc.) — give each a thematic title.
- Each imagePrompt must be 1–3 sentences describing a single key visual moment from that page.
  - Mention subject, setting, mood/lighting, art style.
  - Style guidance: prefer "cinematic illustration, painterly, dramatic lighting" or "storybook illustration, soft watercolor".
  - Keep imagePrompts visually concrete; do NOT include text or letters in the image.`;

const MAX_WORDS_PER_PAGE = 50;

type RawStory = {
  title: string;
  pages: { title: string; body: string; imagePrompt: string }[];
};

// Hard cap on body length. The system prompt asks the model to stay under this,
// but enforce it server-side so a chatty model can't break the limit.
function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  const clipped = words.slice(0, maxWords).join(" ").replace(/[,;:—\-]+$/, "");
  return /[.!?…]$/.test(clipped) ? clipped : clipped + "…";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function isRawStory(x: unknown): x is RawStory {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (!Array.isArray(o.pages) || o.pages.length !== 5) return false;
  return o.pages.every((p) => {
    if (!p || typeof p !== "object") return false;
    const r = p as Record<string, unknown>;
    return (
      typeof r.title === "string" &&
      typeof r.body === "string" &&
      typeof r.imagePrompt === "string"
    );
  });
}

async function generateStoryText(prompt: string): Promise<RawStory> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const appName = process.env.OPENROUTER_APP_NAME || "Storymenia";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Title": appName,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Write a 5-page story about: ${prompt}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.85,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  const raw = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = raw.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("OpenRouter returned no content.");

  const parsed = JSON.parse(extractJson(content));
  if (!isRawStory(parsed)) {
    throw new Error("Story didn't match expected shape (need title + 5 pages with imagePrompts).");
  }
  return parsed;
}

// OpenRouter image generation goes through the chat-completions endpoint with
// an image-capable model (e.g. Gemini 2.5 Flash Image). The response embeds the
// image as a base64 data URI in either `message.images[].image_url.url` or
// `message.content[].image_url.url`, depending on the upstream provider.
async function generateOpenRouterImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model =
    process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-image";
  const appName = process.env.OPENROUTER_APP_NAME || "Storymenia";

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": appName,
      },
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: `Generate a single illustration. Subject: ${prompt}. No text or letters in the image.`,
          },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  try {
    const json = (await res.json()) as {
      choices?: {
        message?: {
          content?: unknown;
          images?: { image_url?: { url?: string }; url?: string }[];
        };
      }[];
    };
    const message = json.choices?.[0]?.message;
    if (!message) return null;

    if (Array.isArray(message.images)) {
      for (const img of message.images) {
        const url = img?.image_url?.url ?? img?.url;
        if (typeof url === "string" && url.length > 0) return url;
      }
    }

    if (Array.isArray(message.content)) {
      for (const part of message.content as { type?: string; image_url?: { url?: string } }[]) {
        if (part?.type === "image_url" && part?.image_url?.url) {
          return part.image_url.url;
        }
      }
    }
  } catch {
    // fall through to null
  }

  return null;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: "OPENROUTER_API_KEY is not set in .env.local." },
      { status: 500 }
    );
  }

  let prompt: string;
  try {
    const body = await req.json();
    prompt = String(body.prompt ?? "").trim();
  } catch {
    return NextResponse.json<GenerateResponse>({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json<GenerateResponse>({ ok: false, error: "Please enter a topic." }, { status: 400 });
  }
  if (prompt.length > 1000) {
    return NextResponse.json<GenerateResponse>({ ok: false, error: "Topic is too long (max 1000 chars)." }, { status: 400 });
  }

  let raw: RawStory;
  try {
    raw = await generateStoryText(prompt);
  } catch (err) {
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: err instanceof Error ? err.message : "Story generation failed." },
      { status: 502 }
    );
  }

  // Generate all 5 images in parallel via OpenRouter. If any fail, the page
  // falls back to the "illustration unavailable" placeholder.
  const imageResults = await Promise.allSettled(
    raw.pages.map((p) => generateOpenRouterImage(p.imagePrompt))
  );

  const pages: StoryPage[] = raw.pages.map((p, i) => {
    const r = imageResults[i];
    return {
      title: p.title,
      body: clampWords(p.body, MAX_WORDS_PER_PAGE),
      imagePrompt: p.imagePrompt,
      imageUrl: r.status === "fulfilled" ? r.value : null,
    };
  });

  const story: Story = { title: raw.title, pages };
  return NextResponse.json<GenerateResponse>({ ok: true, story });
}
