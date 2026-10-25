import { describe, expect, it } from 'vitest';
import { applyState, decodeShare } from '../src/app/urlState';
import type { ShareView } from '../src/app/urlState';
import { Controller } from '../src/app/controller';
import type { ViewPort } from '../src/app/controller';
import { links, plainText, sections, titleOf } from '../src/learn/markdown';
import { REFERENCES, renderReferences } from '../src/learn/references';
import { renderMarkdown } from '../src/learn/render';
import { findPreset, PRESETS } from '../src/presets';
import { FIGURE_EIGHT } from '../src/presets/figureEight';
import { defaultSettings } from '../src/render/scene';
import type { CameraMode } from '../src/render/scene';
import type { SystemState } from '../src/sim/types';
import { cardFor, cardText } from '../src/ui/infoCards';

const content = import.meta.glob('../src/learn/content/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(content).sort(([a], [b]) => a.localeCompare(b));

describe('renderMarkdown', () => {
  it('renders markdown: headings, emphasis, lists, tables', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<li>two</li>');
    expect(html).toContain('<table>');
  });

  it('renders inline and display math with KaTeX', () => {
    const html = renderMarkdown('The energy $E=\\tfrac12 mv^2$ and\n\n$$\\ddot{\\mathbf r}=\\mathbf a$$\n\nend.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<div class="math">');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('$');
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('<p><div'); // the display math is not left inside a paragraph
  });

  it('does not treat a lone dollar sign as math', () => {
    const html = renderMarkdown('It costs $5 and that is all.');
    expect(html).toContain('$5');
    expect(html).not.toContain('katex');
  });

  it('turns :::deeper into a collapsible block that holds markdown and math', () => {
    const html = renderMarkdown('Before.\n\n:::deeper\nInside with $x^2$ and a [link](a.html).\n:::\n\nAfter.');
    expect(html).toContain('<details class="deeper"><summary>Go deeper</summary>');
    expect(html).toMatch(/<details[^>]*>.*class="katex".*<a href="a.html">link<\/a>.*<\/details>/s);
    expect(html.indexOf('Before')).toBeLessThan(html.indexOf('<details'));
    expect(html.indexOf('</details>')).toBeLessThan(html.indexOf('After'));
  });

  it('marks links that start with "Try it"', () => {
    const html = renderMarkdown('[Try it: leapfrog](index.html#preset=figure-eight)\n\n[Other](x.html)');
    expect(html).toContain('<a href="index.html#preset=figure-eight" class="try-it">Try it: leapfrog</a>');
    expect(html).toContain('<a href="x.html">Other</a>');
  });

  it('does not let raw HTML through', () => {
    const html = renderMarkdown('<script>alert(1)</script> and <b>bold</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
  });

  it('survives unbalanced math without throwing', () => {
    expect(() => renderMarkdown('$\\frac{1}{$ and $$ oops')).not.toThrow();
  });
});

describe('markdown helpers', () => {
  const md = '# The title\n\nIntro text.\n\n## Idea\n\nFirst.\n\n## Strengths and weaknesses\n\nSecond.\n\nMore.\n';

  it('finds the title and splits sections by their ## headings, lower-cased', () => {
    expect(titleOf(md)).toBe('The title');
    expect(sections(md)).toEqual({ intro: 'Intro text.', idea: 'First.', 'strengths and weaknesses': 'Second.\n\nMore.' });
  });

  it('strips markdown and math for a tooltip', () => {
    expect(plainText('Use **bold**, `code`, $x^2$, a [link](u), and\n\n$$y$$ end.\n:::deeper')).toBe('Use bold, code, , a link, and end.');
  });

  it('lists links', () => {
    expect(links('a [one](x) b [two](y#z)')).toEqual([
      { text: 'one', href: 'x' },
      { text: 'two', href: 'y#z' },
    ]);
  });
});

describe('the Learn content', () => {
  it('has the sections of plan §11, in order, with titles', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    const names = files.map(([path]) => path.split('/').pop() as string);
    const numbers = names.map((n) => Number.parseInt(n, 10));
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
    for (const [path, source] of files) expect(titleOf(source), path).not.toBe('');
  });

  it('renders every file without a KaTeX error or a stray dollar sign', () => {
    for (const [path, source] of files) {
      const html = renderMarkdown(source);
      expect(html, path).not.toContain('katex-error');
      expect(html.replace(/<span class="katex-html"[\s\S]*?<\/span><\/span><\/span>/g, ''), path).not.toMatch(/\$[^$<]*\$/);
    }
  });

  it('gives every file a "Go deeper" section, as the plan asks, except the glossary and units', () => {
    for (const [path, source] of files) {
      if (/glossary|units/.test(path)) continue;
      expect(source, path).toContain(':::deeper');
    }
  });

  it('keeps the dollar signs balanced, so no stray math is left unrendered', () => {
    for (const [path, source] of files) expect(((source.match(/\$/g) ?? []).length) % 2, path).toBe(0);
  });
});

describe('integrator cards', () => {
  const cardFiles = files.filter(([path]) => /05[a-e]-/.test(path));

  it('each of the five methods has a file with the headings a card is read from', () => {
    expect(cardFiles).toHaveLength(5);
    for (const [path, source] of cardFiles) {
      const s = sections(source);
      for (const key of ['idea', 'analogy', 'strengths and weaknesses', 'cost', 'when to use it']) {
        expect(s[key], `${path}: ${key}`).toBeTruthy();
      }
    }
  });

  it.each(['euler', 'symplectic-euler', 'leapfrog', 'rk4', 'wh', 'ias15'])('%s has a card for the panel', (method) => {
    const card = cardFor(method);
    expect(card).not.toBeNull();
    expect(card!.idea.length).toBeGreaterThan(30);
    expect(card!.strengths.length).toBeGreaterThan(30);
    expect(card!.learnHref).toMatch(/^#\/learn\/[a-z0-9-]+$/);
    expect(cardText(card!)).not.toMatch(/[$*`[\]]/); // plain text: no math, markdown or link syntax
  });

  it("shares Euler's card between explicit and symplectic Euler, and says they differ", () => {
    expect(cardFor('symplectic-euler')).toEqual(cardFor('euler'));
    expect(cardFor('euler')!.strengths).toMatch(/symplectic Euler/);
  });

  it('has no card for a method that does not exist', () => {
    expect(cardFor('rocket')).toBeNull();
  });

  it('puts the Learn anchors where the Learn page puts its sections: the file name without its number', () => {
    expect(cardFor('wh')!.learnHref).toBe('#/learn/wisdom-holman');
    expect(cardFor('ias15')!.learnHref).toBe('#/learn/ias15');
  });
});

class StubView implements ViewPort, ShareView {
  settings = defaultSettings();
  camera = { position: { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } } };
  frame: ((dt: number) => SystemState) | null = null;
  setSystemScale(): void {}
  setCameraMode(mode: CameraMode): void {
    this.settings.cameraMode = mode;
  }
  recordSample(): void {}
  recordGhostSample(): void {}
  setGhost(): void {}
  clearTrails(): void {}
  setTrailLength(): void {}
  start(frame: (dt: number) => SystemState): void {
    this.frame = frame;
  }
}

describe('"Try it" links open the right state', () => {
  const tryLinks = files.flatMap(([path, source]) => links(source).filter((l) => l.text.startsWith('Try it')).map((l) => ({ path, ...l })));
  const presetLinks = PRESETS.map((p) => ({ path: 'presets', text: `Try it: ${p.name}`, href: `index.html#preset=${p.id}` }));

  it('has plenty of them, and every one points at the simulator', () => {
    expect(tryLinks.length).toBeGreaterThanOrEqual(18);
    for (const link of tryLinks) expect(link.href, `${link.path}: ${link.text}`).toMatch(/^index\.html#/);
  });

  it.each([...tryLinks, ...presetLinks].map((l) => [`${l.path}: ${l.text}`, l.href] as const))('%s', (_name, href) => {
    const state = decodeShare(href.slice(href.indexOf('#')));
    expect(state, href).not.toBeNull();
    const preset = findPreset(state!.preset);
    expect(preset, `preset ${state!.preset}`).toBeDefined();
    // Every parameter named exists on the preset, and every setting is one the simulator knows.
    for (const key of Object.keys(state!.params ?? {})) {
      expect(preset!.params?.map((p) => p.key), `${key} on ${preset!.id}`).toContain(key);
    }
    const view = new StubView();
    const controller = new Controller(view, FIGURE_EIGHT);
    controller.start();
    expect(applyState(controller, view, state!)).toBe(true);
    expect(controller.preset.id).toBe(preset!.id);
    if (state!.integrator) {
      const wanted = state!.integrator === 'symplectic-euler' ? 'euler' : state!.integrator;
      expect(controller.sim.integrator.id).toBe(wanted);
    }
    if (state!.dt !== undefined) expect(controller.sim.params.dt).toBe(state!.dt);
    for (let i = 0; i < 20; i++) view.frame!(1 / 60);
    expect(controller.sim.failure, href).toBeNull();
    expect(controller.sim.state.t).toBeGreaterThan(0);
  });
});

describe('references', () => {
  it('has unique ids, and every entry says who, when, what and where', () => {
    expect(new Set(REFERENCES.map((r) => r.id)).size).toBe(REFERENCES.length);
    for (const r of REFERENCES) {
      expect(r.authors, r.id).toBeTruthy();
      expect(r.year, r.id).toBeGreaterThan(1900);
      expect(r.title, r.id).toBeTruthy();
      expect(r.venue, r.id).toBeTruthy();
      for (const link of r.links) expect(link.href, r.id).toMatch(/^https:\/\//);
    }
  });

  it('includes what the presets and the text cite', () => {
    const cited = ['1303.0181', '1312.6796', '1911.03984', '1409.4779', 'Wisdom', 'Szebehely', 'Moore', 'Chenciner', 'Everhart', 'Rein'];
    const text = JSON.stringify(REFERENCES);
    for (const needle of cited) expect(text, needle).toContain(needle);
    // The preset sources name arXiv papers: each must be in the list.
    for (const preset of PRESETS) {
      for (const id of preset.source.match(/arXiv:\d{4}\.\d{4,5}/g) ?? []) {
        expect(text, `${preset.id}: ${id}`).toContain(id.replace('arXiv:', ''));
      }
    }
  });

  it('renders as an ordered list with links, and escapes what it prints', () => {
    const html = renderReferences([
      { id: 'x', authors: 'A <b>', year: 2000, title: 'T & U', venue: 'V', links: [{ label: 'L', href: 'https://example.org/?a=1&b=2' }] },
    ]);
    expect(html).toContain('<ol class="references">');
    expect(html).toContain('A &lt;b&gt;');
    expect(html).toContain('T &amp; U');
    expect(html).toContain('href="https://example.org/?a=1&amp;b=2"');
  });
});
