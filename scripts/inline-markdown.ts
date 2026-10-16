import { Lexer, type MarkedToken, type Token } from "marked";

export type InlineMarkdownToken =
  | { kind: "text" | "code"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: InlineMarkdownToken[] }
  | { kind: "link"; children: InlineMarkdownToken[]; target: string }
  | { kind: "image"; alt: string; target: string };

function inlineTokens(tokens: readonly Token[]): InlineMarkdownToken[] {
  const result: InlineMarkdownToken[] = [];
  // No Marked extensions are registered, so only built-in tokens are produced.
  for (const token of tokens as readonly MarkedToken[]) {
    switch (token.type) {
      case "strong":
      case "em":
      case "del":
        result.push({
          kind: token.type === "strong" ? "bold" : token.type === "em" ? "italic" : "strike",
          children: inlineTokens(token.tokens),
        });
        break;
      case "link":
        result.push({ kind: "link", children: inlineTokens(token.tokens), target: token.href });
        break;
      case "image":
        result.push({
          kind: "image",
          alt: inlineMarkdownTokensPlainText(inlineTokens(token.tokens)),
          target: token.href,
        });
        break;
      case "codespan":
        result.push({ kind: "code", text: token.text });
        break;
      case "text":
      case "escape":
      case "html":
      case "br": {
        // Raw HTML remains literal text, never document markup.
        const text = token.type === "br" ? "\n" : token.text;
        const previous = result.at(-1);
        if (previous?.kind === "text") previous.text += text;
        else result.push({ kind: "text", text });
        break;
      }
      default:
        throw new SyntaxError(`Unsupported inline Markdown token: ${token.type}`);
    }
  }
  return result;
}

export function findInlineCodeSpan(source: string, start: number): { text: string; end: number } | undefined {
  if (source[start] !== "`") return undefined;
  const token = Lexer.lexInline(source.slice(start), { gfm: true })[0] as MarkedToken | undefined;
  return token?.type === "codespan"
    ? { text: token.text, end: start + token.raw.length }
    : undefined;
}

export function tokenizeInlineMarkdown(source: string): InlineMarkdownToken[] {
  return inlineTokens(Lexer.lexInline(source, { gfm: true }));
}

export function inlineMarkdownTokensPlainText(tokens: readonly InlineMarkdownToken[]): string {
  return tokens
    .map((token) => "children" in token
      ? inlineMarkdownTokensPlainText(token.children)
      : token.kind === "image" ? token.alt : token.text)
    .join("");
}

export function markdownInlinePlainText(source: string): string {
  return inlineMarkdownTokensPlainText(tokenizeInlineMarkdown(source));
}
