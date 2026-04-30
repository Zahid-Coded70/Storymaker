export type StoryPage = {
  title: string;
  body: string;
  imagePrompt: string;
  imageUrl: string | null;
};

export type Story = {
  title: string;
  pages: StoryPage[];
};

export type GenerateResponse =
  | { ok: true; story: Story }
  | { ok: false; error: string };
