import { Marked, Renderer, type Tokens } from "marked";

export function markdownToHtml(markdown: string, codeAppendixThreshold?: number): string {
  if (codeAppendixThreshold !== undefined &&
      (!Number.isSafeInteger(codeAppendixThreshold) || codeAppendixThreshold < 1)) {
    throw new RangeError("The code appendix threshold must be a positive integer.");
  }

  const appendices: Tokens.Code[] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      code(token) {
        if (codeAppendixThreshold === undefined || token.codeBlockStyle === "indented" ||
            token.text.split("\n").length <= codeAppendixThreshold) return false;
        appendices.push(token);
        const number = appendices.length;
        return `<p><a href="#appendix-code-${number}">Appendix ${number}</a></p>\n`;
      },
    },
  });
  const body = marked.parse(markdown, { async: false });
  if (appendices.length === 0) return body;

  const renderer = new Renderer();
  return body + '\n<!-- pagebreak -->\n<h2>Appendix</h2>\n' + appendices.map((token, index) =>
    `<h3 id="appendix-code-${index + 1}">Appendix ${index + 1}</h3>\n${renderer.code(token)}`,
  ).join("\n");
}
