// The chat's replies are text with a little formatting: paragraphs split by a
// blank line, "- " and "1. " lists, and **bold** (rendered by app/chat-text.tsx).
// Anything else (a stray heading mark, a table) shows as plain text.
export type ChatBlock = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const last = blocks.at(-1);
    if (!line.trim()) {
      if (last?.kind === "p") blocks.push({ kind: "p", lines: [] }); // close the paragraph
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : "p";
    if (kind === "p") {
      const lineText = line.replace(/^\s*#{1,6}\s+/, "");
      if (last?.kind === "p") last.lines.push(lineText);
      else blocks.push({ kind: "p", lines: [lineText] });
    } else {
      const item = line.replace(kind === "ul" ? BULLET : NUMBERED, "");
      if (last?.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    }
  }
  return blocks.filter((block) => (block.kind === "p" ? block.lines.length > 0 : true));
}
