import katex from 'katex';
import 'katex/dist/katex.min.css';
import MarkdownIt from 'markdown-it';

// Markdown to HTML for the Learn page: markdown-it, with KaTeX for $...$ and $$...$$, and a
// `:::deeper` block for the collapsible "Go deeper" sections. Links whose text starts with
// "Try it" get a class, so the page can style them as the buttons that open the simulator.

const md = new MarkdownIt({ html: false, linkify: false, typographer: true });

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const next = tokens[idx + 1];
  if (next?.type === 'text' && next.content.startsWith('Try it')) tokens[idx].attrJoin('class', 'try-it');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

function math(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' });
}

/**
 * Renders markdown to an HTML string. Math and `:::deeper` blocks are swapped for placeholders
 * before markdown-it (which would mangle them) and put back after.
 */
export function renderMarkdown(source: string): string {
  const stash: string[] = [];
  const hold = (html: string): string => `${stash.push(html) - 1}`;

  let text = source.replace(/^:::deeper\n([\s\S]*?)\n:::[ \t]*$/gm, (_m, inner: string) =>
    hold(`<details class="deeper"><summary>Go deeper</summary>${renderMarkdown(inner)}</details>`),
  );
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => hold(`<div class="math">${math(tex.trim(), true)}</div>`));
  text = text.replace(/(?<![\\$\w])\$([^\s$](?:[^$\n]*[^\s$])?)\$(?![\w$])/g, (_m, tex: string) => hold(math(tex, false)));

  let html = md.render(text);
  // A held block that stands alone was wrapped in a paragraph: take it out again.
  html = html.replace(/<p>(\d+)<\/p>/g, '$1');
  return html.replace(/(\d+)/g, (_m, i: string) => stash[Number(i)]);
}
