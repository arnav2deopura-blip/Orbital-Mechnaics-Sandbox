// Small helpers for the Learn page's markdown that need no markdown library, so the simulator's
// info cards can use them without loading one.

/** The text of the first `# ` heading. */
export function titleOf(md: string): string {
  const match = /^#\s+(.+)$/m.exec(md);
  return match ? match[1].trim() : '';
}

/**
 * Splits markdown on its `## ` headings into { heading: text }. The heading is lower-cased; text
 * before the first one (after the title) is "intro". An integrator's card is read this way.
 */
export function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = 'intro';
  let lines: string[] = [];
  const flush = (): void => {
    out[key] = lines.join('\n').trim();
  };
  for (const line of md.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      key = heading[1].trim().toLowerCase();
      lines = [];
    } else if (!/^#\s/.test(line)) {
      lines.push(line);
    }
  }
  flush();
  return out;
}

/** Text with the markdown and math removed, for a tooltip or a panel: links keep their words, math is dropped. */
export function plainText(md: string): string {
  return md
    .replace(/^:::.*$/gm, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$\n]+\$/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Link {
  text: string;
  href: string;
}

/** Every `[text](href)` in the markdown. */
export function links(md: string): Link[] {
  return [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ text: m[1], href: m[2] }));
}
