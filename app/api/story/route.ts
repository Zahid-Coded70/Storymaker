import { NextRequest, NextResponse } from "next/server";
import type { GenerateResponse, Story } from "../../types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a creative storyteller. Given a topic, write a vivid 5-page story.

Output ONLY a single JSON object with this exact shape — no markdown fences, no commentary:

{
  "title": "the story's title (under 80 characters)",
  "pages": [
    { "title": "page 1 title (under 60 chars)", "body": "page 1 narrative — 2 to 4 paragraphs" },
    { "title": "page 2 title", "body": "page 2 narrative" },
    { "title": "page 3 title", "body": "page 3 narrative" },
    { "title": "page 4 title", "body": "page 4 narrative" },
    { "title": "page 5 title", "body": "page 5 narrative" }
  ]
}

Rules:
- Exactly 5 pages.
- Each page should be 150–280 words of prose.
- Pages flow together as one continuous story with a clear arc: setup, rising action, climax, falling action, resolution.
- Use sensory detail. Show, don't tell.
- Do not number the page titles ("Page 1:" etc.) — give each a thematic title.`;

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

function isStory(x: unknown): x is Story {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (!Array.isArray(o.pages) || o.pages.length !== 5) return false;
  return o.pages.every(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof (p as Record<string, unknown>).title === "string" &&
      typeof (p as Record<string, unknown>).body === "string"
  );
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: "OPENROUTER_API_KEY is not set. Copy .env.local.example to .env.local and add your key." },
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

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const appName = process.env.OPENROUTER_APP_NAME || "Storymaker";

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
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Write a 5-page story about: ${prompt}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.85,
      }),
    });
  } catch (err) {
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: `Network error contacting OpenRouter: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: `OpenRouter responded ${res.status}: ${text.slice(0, 300)}` },
      { status: res.status }
    );
  }

  let raw: { choices?: { message?: { content?: string } }[] };
  try {
    raw = await res.json();
  } catch {
    return NextResponse.json<GenerateResponse>({ ok: false, error: "OpenRouter returned non-JSON." }, { status: 502 });
  }

  const content = raw.choices?.[0]?.message?.content ?? "";
  if (!content) {
    return NextResponse.json<GenerateResponse>({ ok: false, error: "OpenRouter returned no content." }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch (err) {
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: `Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  if (!isStory(parsed)) {
    return NextResponse.json<GenerateResponse>(
      { ok: false, error: "Model output didn't match the expected story shape (need title + 5 pages)." },
      { status: 502 }
    );
  }

  return NextResponse.json<GenerateResponse>({ ok: true, story: parsed });
}
