import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Storymaker",
  description: "Type a topic, get a 5-page story.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
