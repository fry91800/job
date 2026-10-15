import { Fragment, type ReactNode } from "react";

import { parseMarkdown } from "./markdown-parse";

// Rendered as React elements only: any HTML in the text stays text (descriptions come
// from external sites).
const INLINE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = nodes.length;
    if (match[1] !== undefined) nodes.push(<strong key={key} className="font-semibold">{match[1]}</strong>);
    else if (match[2] !== undefined || match[3] !== undefined) nodes.push(<em key={key}>{match[2] ?? match[3]}</em>);
    else
      nodes.push(
        <a key={key} href={match[5]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">
          {match[4]}
        </a>,
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "heading") return <h3 key={index} className="mt-2 text-base font-semibold">{renderInline(block.text)}</h3>;
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index} className={`flex flex-col gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-fg-subtle`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
