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
      "body": "page 1 narrative — 2 to 4 paragraphs",
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
- Each page body should be 150–280 words of prose.
- Pages flow as one continuous story with a clear arc: setup, rising action, climax, falling action, resolution.
- Use sensory detail. Show, don't tell.
- Do not number page titles ("Page 1:" etc.) — give each a thematic title.
- Each imagePrompt must be 1–3 sentences describing a single key visual moment from that page.
  - Mention subject, setting, mood/lighting, art style.
  - Style guidance: prefer "cinematic illustration, painterly, dramatic lighting" or "storybook illustration, soft watercolor".
  - Keep imagePrompts visually concrete; do NOT include text or letters in the image.`;

type RawStory = {
  title: string;
  pages: { title: string; body: string; imagePrompt: string }[];
};

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

async function generateLumenImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.LUMEN_API_KEY;
  if (!apiKey) return null;
  const modelId = Number(process.env.LUMEN_MODEL_ID) || 19;

  let res: Response;
  try {
    res = await fetch("https://app.lumenpro.io/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 1_000_000),
        method: "tools/call",
        params: {
          name: "generate_image",
          arguments: { model_id: modelId, prompt },
        },
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const text = await res.text();

  // Response is SSE: lines starting with "data: <json>". The final non-notification entry
  // has the actual result. Walk from the end and find the first parseable result.
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);

  const candidates = dataLines.length ? dataLines : [text.trim()];

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed.result?.content) {
        const textBlock = parsed.result.content.find(
          (c: { type?: string }) => c.type === "text"
        );
        const content: string = textBlock?.text ?? "";
        const urlMatch = content.match(/https?:\/\/[^\s)\]]+?\.(?:png|jpg|jpeg|webp|gif)/i);
        if (urlMatch) return urlMatch[0];
      }
    } catch {
      // not JSON, try next
    }
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

  // Generate all 5 images in parallel. If any fail, page just shows no image.
  const imageResults = await Promise.allSettled(
    raw.pages.map((p) => generateLumenImage(p.imagePrompt))
  );

  const pages: StoryPage[] = raw.pages.map((p, i) => ({
    title: p.title,
    body: p.body,
    imagePrompt: p.imagePrompt,
    imageUrl:
      imageResults[i].status === "fulfilled" ? imageResults[i].value : null,
  }));

  const story: Story = { title: raw.title, pages };
  return NextResponse.json<GenerateResponse>({ ok: true, story });
}
