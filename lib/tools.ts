export interface Tool {
  mark: string;
  name: string;
  blurb: string;
  href: string;
}

export const tools: Tool[] = [
  {
    mark: "/icon-mark.png",
    name: "REIscore",
    blurb: "Analyze deals fast — run comps, ARV, and offers on any property.",
    href: "/analyzer",
  },
  {
    mark: "/icon-mark.png",
    name: "REIscrub",
    blurb: "Clean and dedupe your lead lists before you dial or mail.",
    href: "/leads/import",
  },
];
