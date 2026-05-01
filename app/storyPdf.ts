import jsPDF from "jspdf";
import type { Story } from "./types";

// A4 portrait in millimeters
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// jsPDF's built-in helvetica is WinAnsi-only; the LLM tends to emit smart
// quotes / em-dashes / ellipses that would render as garbage. Strip those
// down to ASCII equivalents before drawing.
function normalizeText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

function detectFormat(dataUrl: string): "PNG" | "JPEG" {
  return /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
}

function safeFilename(title: string): string {
  const slug = title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "story"}.pdf`;
}

export function downloadStoryPdf(story: Story): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // --- Title page ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(20, 20, 20);
  const titleLines = doc.splitTextToSize(normalizeText(story.title), CONTENT_W);
  const titleY = PAGE_H / 2 - (titleLines.length * 11) / 2;
  doc.text(titleLines, PAGE_W / 2, titleY, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(140, 140, 140);
  doc.text("StoryMania", PAGE_W / 2, PAGE_H - MARGIN, { align: "center" });

  // --- Story pages ---
  story.pages.forEach((page, i) => {
    doc.addPage();
    let y = MARGIN;

    // Image (centered, square)
    if (page.imageUrl && page.imageUrl.startsWith("data:image/")) {
      const imgSize = 120;
      const x = (PAGE_W - imgSize) / 2;
      try {
        doc.addImage(page.imageUrl, detectFormat(page.imageUrl), x, y, imgSize, imgSize);
        y += imgSize + 10;
      } catch {
        // Skip image on decode error; text layout still works.
      }
    }

    // Page-of-pages label
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(140, 140, 140);
    doc.text(`Page ${i + 1} of ${story.pages.length}`, MARGIN, y);
    y += 6;

    // Page title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(30, 30, 30);
    const ptLines = doc.splitTextToSize(normalizeText(page.title), CONTENT_W);
    doc.text(ptLines, MARGIN, y);
    y += ptLines.length * 7 + 4;

    // Body
    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.setTextColor(50, 50, 50);
    const bodyLines = doc.splitTextToSize(normalizeText(page.body), CONTENT_W);
    doc.text(bodyLines, MARGIN, y, { lineHeightFactor: 1.45 });
  });

  doc.save(safeFilename(story.title));
}
