"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import type { GenerateResponse, Story } from "./types";
import { clearCurrentStory, loadCurrentStory, saveCurrentStory } from "./storyDb";

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
  const [voiceOn, setVoiceOn] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Restore the saved story (if any) on first mount.
  useEffect(() => {
    let alive = true;
    loadCurrentStory().then((saved) => {
      if (!alive) return;
      if (saved) {
        setStory(saved.story);
        setPageIdx(saved.pageIdx);
        setView("story");
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Persist story + pageIdx whenever they change (after hydration). When the
  // user resets back to the prompt screen, clear the saved record.
  useEffect(() => {
    if (!hydrated) return;
    if (view === "story" && story) {
      saveCurrentStory(story, pageIdx);
    } else if (view === "idle") {
      clearCurrentStory();
    }
    // "loading" is intentionally a no-op so a refresh mid-generation doesn't
    // overwrite or restore stale state.
  }, [hydrated, view, story, pageIdx]);

  // Speak the current page; on natural end, auto-advance to the next page.
  // Cancellation flag prevents the canceled-utterance `onend` callback from
  // incorrectly auto-advancing when the user navigates manually.
  useEffect(() => {
    if (view !== "story" || !story || !voiceOn) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const synth = window.speechSynthesis;
    const page = story.pages[pageIdx];
    const text = `${page.title}. ${page.body}`;

    synth.cancel();

    let cancelled = false;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.95;
    utter.pitch = 1;
    utter.onend = () => {
      if (cancelled) return;
      if (pageIdx < story.pages.length - 1) {
        setPageIdx((i) => Math.min(story.pages.length - 1, i + 1));
      }
    };
    synth.speak(utter);

    return () => {
      cancelled = true;
      synth.cancel();
    };
  }, [view, story, pageIdx, voiceOn]);

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
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setStory(null);
    setPageIdx(0);
    setView("idle");
    setError(null);
  }

  // Don't render until we've checked IDB — prevents the prompt screen from
  // flashing on first paint when a saved story is about to be restored.
  if (!hydrated) {
    return <main className={styles.app} />;
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
    const imgKey = `${pageIdx}-${page.imageUrl ?? "none"}`;
    return (
      <main className={styles.app}>
        <div className={styles.storyView}>
          <div className={styles.siteName}>StoryMania</div>
          <div className={styles.storyHeader}>
            <h1 className={styles.storyTitle}>{story.title}</h1>
            <button
              className={styles.newStoryBtn}
              onClick={() => setVoiceOn((v) => !v)}
              aria-pressed={voiceOn}
              title={voiceOn ? "Turn narration off" : "Turn narration on"}
            >
              {voiceOn ? "Voice on" : "Voice off"}
            </button>
            <button className={styles.newStoryBtn} onClick={reset}>
              New story
            </button>
          </div>

          <article className={styles.pageCard}>
            {page.imageUrl ? (
              <img
                key={imgKey}
                src={page.imageUrl}
                alt={page.imagePrompt}
                className={styles.pageImage}
                loading="eager"
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = "none";
                  const sibling = el.nextElementSibling as HTMLElement | null;
                  if (sibling) sibling.style.display = "flex";
                }}
              />
            ) : null}
            <div
              className={styles.pageImagePlaceholder}
              style={{ display: page.imageUrl ? "none" : "flex" }}
            >
              <span>Illustration unavailable for this page</span>
            </div>
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
