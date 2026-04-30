export type StoryPage = {
  title: string;
  body: string;
};

export type Story = {
  title: string;
  pages: StoryPage[];
};

export type GenerateResponse =
  | { ok: true; story: Story }
  | { ok: false; error: string };
