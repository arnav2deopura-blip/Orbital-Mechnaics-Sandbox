// Learn page entry (learn.html): plain-language explanations of the simulator (plan §11).
// Content comes from src/learn/content/*.md, in file-name order, with the sections that come
// from data (the presets, the references) slotted in. Every "Try it" link opens the simulator
// in a prepared state (src/app/urlState.ts).
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import '../ui/tokens.css';
import './learn.css';
import { PRESETS } from '../presets';
import { titleOf } from './markdown';
import { renderReferences } from './references';
import { renderMarkdown } from './render';

const files = import.meta.glob('./content/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Section {
  id: string;
  title: string;
  html: string;
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One paragraph per preset (plan §11, §8): what it shows, where it comes from, and whether it has been checked. */
function presetsSection(): Section {
  const articles = PRESETS.map((preset) => {
    const checked = preset.verified
      ? `Checked by a test: ${escape(preset.verifiedBy ?? 'behaves as described')}.`
      : 'Not independently checked.';
    return (
      `<article id="preset-${preset.id}"><h3>${escape(preset.name)}</h3>` +
      `<p>${escape(preset.demonstrates)}</p>` +
      `<p class="meta">Source: ${escape(preset.source)} ${checked}</p>` +
      `<p><a class="try-it" href="index.html#preset=${preset.id}">Try it: ${escape(preset.name)}</a></p></article>`
    );
  });
  return {
    id: 'presets',
    title: 'The presets explained',
    html: `<h1>The presets explained</h1><p>Each preset in the menu, with where it comes from. A preset is marked as checked only when a test has run it and confirmed what it claims.</p>${articles.join('')}`,
  };
}

function build(): Section[] {
  const sections: Section[] = [];
  const names = Object.keys(files).sort();
  let presetsDone = false;
  for (const path of names) {
    const file = path.split('/').pop() ?? path;
    const number = Number.parseInt(file, 10);
    if (!presetsDone && number >= 11) {
      sections.push(presetsSection());
      presetsDone = true;
    }
    const source = files[path];
    sections.push({
      id: file.replace(/^\d+[a-z]?-/, '').replace(/\.md$/, ''),
      title: titleOf(source),
      html: renderMarkdown(source),
    });
  }
  sections.push({ id: 'references', title: 'References', html: `<h1>References</h1>${renderReferences()}` });
  return sections;
}

function mount(root: HTMLElement): void {
  const sections = build();
  const nav = sections.map((s) => `<li><a href="#${s.id}">${escape(s.title)}</a></li>`).join('');
  const body = sections.map((s) => `<section id="${s.id}">${s.html}</section>`).join('');
  root.innerHTML =
    `<nav class="toc"><a class="back" href="index.html">&larr; The simulator</a><ol>${nav}</ol></nav>` +
    `<main><header><h1 class="page-title">How the integrators work</h1>` +
    `<p class="lede">Plain language first. Open <em>Go deeper</em> for the equations, and <em>Try it</em> to see it in the simulator.</p></header>${body}</main>`;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  followReader(root);
}

/** Marks the contents entry of the section being read. */
function followReader(root: HTMLElement): void {
  const links = new Map<string, HTMLAnchorElement>();
  root.querySelectorAll<HTMLAnchorElement>('.toc li a').forEach((a) => links.set(a.getAttribute('href')?.slice(1) ?? '', a));
  const mark = (id: string): void => {
    for (const [key, a] of links) {
      if (key === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  };
  if (typeof IntersectionObserver === 'undefined') return;
  const seen = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target.id);
        else seen.delete(entry.target.id);
      }
      // The first (topmost) section in the band is the one being read.
      const first = [...root.querySelectorAll<HTMLElement>('main > section')].find((section) => seen.has(section.id));
      if (first) mark(first.id);
    },
    { rootMargin: '-10% 0px -80% 0px' },
  );
  root.querySelectorAll('main > section').forEach((section) => observer.observe(section));
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');
mount(app);
