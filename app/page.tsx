"use client";

import { useState } from "react";
import styles from "./page.module.css";
import type { GenerateResponse, Story } from "./types";

const SUGGESTIONS = [
  "A lighthouse keeper who finds a message in a bottle",
  "The first AI to dream",
  "A detective in 1920s Tokyo",
  "Two strangers stuck in an elevator",
  "A child who can talk to plants",
];

type View = "idle" | "loading" | "story";

export default function Page() {
  const [view, setView] = useState<View>("idle");
  const [prompt, setPrompt] = useState("");
  const [story, setStory] = useState<Story | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    if (!prompt.trim()) return;
    setView("loading");
    setError(null);

    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data: GenerateResponse = await res.json();

      if (!data.ok) {
        setError(data.error);
        setView("idle");
        return;
      }

      setStory(data.story);
      setPageIdx(0);
      setView("story");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setView("idle");
    }
  }

  function reset() {
    setStory(null);
    setPageIdx(0);
    setView("idle");
    setError(null);
  }

  if (view === "loading") {
    return (
      <main className={styles.app}>
        <div className={styles.loadingView}>
          <div className={styles.spinner} />
          <h2 className={styles.loadingTitle}>Writing &amp; illustrating your story…</h2>
          <p className={styles.loadingSub}>This takes about a minute — 5 pages, 5 images.</p>
        </div>
      </main>
    );
  }

  if (view === "story" && story) {
    const page = story.pages[pageIdx];
    return (
      <main className={styles.app}>
        <div className={styles.storyView}>
          <div className={styles.storyHeader}>
            <h1 className={styles.storyTitle}>{story.title}</h1>
            <button className={styles.newStoryBtn} onClick={reset}>
              New story
            </button>
          </div>

          <article className={styles.pageCard}>
            {page.imageUrl ? (
              <img
                src={page.imageUrl}
                alt={page.imagePrompt}
                className={styles.pageImage}
              />
            ) : (
              <div className={styles.pageImagePlaceholder}>
                <span>Illustration unavailable for this page</span>
              </div>
            )}
            <div className={styles.pageMeta}>
              <span className={styles.pageMetaDot} />
              <span>
                Page {pageIdx + 1} of {story.pages.length}
              </span>
            </div>
            <h2 className={styles.pageTitle}>{page.title}</h2>
            <div className={styles.pageBody}>
              {page.body.split(/\n\n+/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </article>

          <nav className={styles.pageNav}>
            <button
              className={styles.navBtn}
              onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              disabled={pageIdx === 0}
            >
              ← Previous
            </button>

            <div className={styles.dots}>
              {story.pages.map((_, i) => (
                <button
                  key={i}
                  className={`${styles.dot} ${i === pageIdx ? styles.dotActive : ""}`}
                  onClick={() => setPageIdx(i)}
                  aria-label={`Go to page ${i + 1}`}
                />
              ))}
            </div>

            <button
              className={styles.navBtn}
              onClick={() => setPageIdx((i) => Math.min(story.pages.length - 1, i + 1))}
              disabled={pageIdx === story.pages.length - 1}
            >
              Next →
            </button>
          </nav>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.app}>
      <div className={styles.promptView}>
        <span className={styles.eyebrow}>✨ Storymenia</span>
        <h1 className={styles.title}>Tell me a story.</h1>
        <p className={styles.tagline}>
          Type a topic, character, or premise. I&apos;ll write you a 5-page
          illustrated tale.
        </p>

        <form className={styles.form} onSubmit={generate}>
          <textarea
            className={styles.input}
            placeholder="A retired astronaut who hears strange music coming from the moon…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
            maxLength={1000}
          />

          <button type="submit" className={styles.button} disabled={!prompt.trim()}>
            Generate story →
          </button>

          <div className={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.suggestion}
                onClick={() => setPrompt(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </form>
      </div>
    </main>
  );
}
