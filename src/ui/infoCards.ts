import { plainText, sections, titleOf } from '../learn/markdown';

// Info cards (plan §11): what each method is, drawn from the same markdown the Learn page shows,
// so the explanation has one source. The card is the integrator's file read by its `##` headings.

const files = import.meta.glob('../learn/content/05*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const FILE_FOR: Record<string, string> = {
  euler: '05a-euler.md',
  'symplectic-euler': '05a-euler.md',
  leapfrog: '05b-leapfrog.md',
  rk4: '05c-rk4.md',
  wh: '05d-wisdom-holman.md',
  ias15: '05e-ias15.md',
};

export interface InfoCard {
  title: string;
  idea: string;
  analogy: string;
  strengths: string;
  cost: string;
  use: string;
  /** Where the Learn page has this method's full card. */
  learnHref: string;
}

/** The card for a method, as plain text for the panel, or null if there is none. 'symplectic-euler' is Euler's card. */
export function cardFor(method: string): InfoCard | null {
  const name = FILE_FOR[method];
  const source = name ? Object.entries(files).find(([path]) => path.endsWith(name))?.[1] : undefined;
  if (!source || !name) return null;
  const s = sections(source);
  return {
    title: titleOf(source),
    idea: plainText(s.idea ?? ''),
    analogy: plainText(s.analogy ?? ''),
    strengths: plainText(s['strengths and weaknesses'] ?? ''),
    cost: plainText(s.cost ?? ''),
    use: plainText(s['when to use it'] ?? ''),
    learnHref: `learn.html#${name.replace(/^\d+[a-z]?-/, '').replace(/\.md$/, '')}`,
  };
}

/** A card as one block of text. */
export function cardText(card: InfoCard): string {
  return `${card.idea}\n\nStrengths and weaknesses: ${card.strengths}\n\nCost: ${card.cost}\n\nUse it for: ${card.use}`;
}
