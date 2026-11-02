export type ChatTurn =
  | { kind: "question"; text: string }
  | { kind: "answer"; text: string; citations: string[] }
  | { kind: "clarify"; text: string; options: string[] };

export const conversation: ChatTurn[] = [
  { kind: "question", text: "What did I decide about keeping the editor calm?" },
  {
    kind: "answer",
    text: "You wanted writing to stay at the center: preserve focus, keep organization optional, and make search easy to reach without letting it compete with the note.",
    citations: ["quiet-systems", "editor-principles"],
  },
  { kind: "question", text: "What should I revisit next?" },
  {
    kind: "clarify",
    text: "Do you mean the next product decision, or the next item from your reading list?",
    options: ["Product decision", "Reading list"],
  },
];
