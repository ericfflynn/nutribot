import { Fragment, type ReactNode } from "react";
import { parseChatText } from "@/lib/chat-text";

// A chat reply's paragraphs, lists and bold, built as React nodes, never HTML.

// **bold** spans; an unmatched ** stays as typed.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong> : part
  );
}

export function ChatText({ text }: { text: string }) {
  return (
    <>
      {parseChatText(text).map((block, index) => {
        if (block.kind === "p") {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex ? <br /> : null}
                  {inline(line)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind;
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </>
  );
}
