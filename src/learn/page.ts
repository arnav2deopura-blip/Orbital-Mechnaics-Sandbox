// The Learn page (plan §11): plain-language explanations of the simulator, one long page in the
// app's own window. Content comes from src/learn/content/*.md, in file-name order, with the
// sections that come from data (the presets, the references) slotted in. Every "Try it" link
// opens the simulator in a prepared state (src/app/urlState.ts); every link is made a link within
// the one page (src/app/router.ts).
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import './learn.css';
import { learnHref, rewriteHref } from '../app/router';
import { PRESETS } from '../presets';
import { titleOf } from './markdown';
import { renderReferences } from './references';
import { renderMarkdown } from './render';

const files = import.meta.glob('./content/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

type Group = 'Foundations' | 'The methods' | 'Behaviour' | 'Reference';

interface Section {
  id: string;
  title: string;
  group: Group;
  html: string;
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Which part of the contents a chapter is in, from its file number: 01-04, 05x, 06-09, then the rest. */
function groupOf(file: string): Group {
  const number = Number.parseInt(file, 10);
  if (file.startsWith('05')) return 'The methods';
  if (number < 5) return 'Foundations';
  if (number < 10) return 'Behaviour';
  return 'Reference';
}

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
    group: 'Reference',
    html: `<h1>The presets explained</h1><p>Each preset in the menu, with where it comes from. A preset is marked as checked only when a test has run it and confirmed what it claims.</p><div class="preset-grid">${articles.join('')}</div>`,
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
      group: groupOf(file),
      html: renderMarkdown(source),
    });
  }
  sections.push({ id: 'references', title: 'References', group: 'Reference', html: `<h1>References</h1>${renderReferences()}` });
  return sections;
}

/** Chapters whose text is a list of short entries, set across the full width of the page. */
const WIDE = ['presets', 'glossary', 'references'];

/** A chapter is two columns: its title (which stays put while the text goes by) and its text. */
function chapter(s: Section): string {
  let body = s.html.replace(/^\s*<h1>[\s\S]*?<\/h1>/, '');
  // The glossary is a run of short definitions: two columns, split here and not by CSS columns,
  // which blank the inline math in Chromium.
  if (s.id === 'glossary') {
    const entries = body.match(/<p>[\s\S]*?<\/p>/g) ?? [];
    const half = Math.ceil(entries.length / 2);
    body = `<div class="gloss-cols"><div>${entries.slice(0, half).join('')}</div><div>${entries.slice(half).join('')}</div></div>`;
  }
  return (
    `<section id="${s.id}" class="chapter${WIDE.includes(s.id) ? ' wide' : ''}">` +
    `<header class="chapter-head"><p class="kicker">${s.group}</p><h1>${escape(s.title)}</h1></header>` +
    `<div class="chapter-body">${body}</div></section>`
  );
}

function contents(sections: Section[]): string {
  const parts: string[] = [];
  let group: Group | null = null;
  for (const s of sections) {
    if (s.group !== group) {
      if (group) parts.push('</ol>');
      group = s.group;
      parts.push(`<p class="toc-group">${s.group}</p><ol>`);
    }
    parts.push(`<li><a href="${learnHref(s.id)}" data-id="${s.id}">${escape(s.title)}</a></li>`);
  }
  parts.push('</ol>');
  return parts.join('');
}

export interface LearnPage {
  /** Scrolls to a chapter, or to something inside one (`preset-<id>`); nothing given means where the reader was. */
  show(section: string, smooth: boolean): void;
}

/** Builds the page into `host`, which is the element that scrolls. */
export function mountLearn(host: HTMLElement): LearnPage {
  const sections = build();
  host.innerHTML =
    `<div class="learn-layout"><nav class="toc" aria-label="Contents">${contents(sections)}</nav>` +
    `<article class="learn-main"><header class="learn-head"><h1 class="page-title">How the integrators work</h1>` +
    `<p class="lede">Plain language first. Open <em>Go deeper</em> for the equations, and <em>Try it</em> to see it in the simulator.</p></header>` +
    `${sections.map(chapter).join('')}</article></div>`;

  // Links written for two pages are links within this one.
  for (const a of host.querySelectorAll<HTMLAnchorElement>('.learn-main a[href]')) {
    a.setAttribute('href', rewriteHref(a.getAttribute('href') ?? ''));
  }

  const find = (id: string): HTMLElement | null => (id ? host.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null);
  const show = (section: string, smooth: boolean): void => {
    const behavior = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
    find(section)?.scrollIntoView({ block: 'start', behavior });
  };

  // A click in the contents moves within the page without adding a history entry for every chapter.
  host.querySelector('.toc')?.addEventListener('click', (event) => {
    const click = event as MouseEvent;
    const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-id]');
    if (!a || click.metaKey || click.ctrlKey || click.shiftKey) return;
    event.preventDefault();
    history.replaceState(null, '', a.getAttribute('href'));
    show(a.dataset.id ?? '', true);
  });

  followReader(host);
  return { show };
}

/** Marks the contents entry of the chapter being read. */
function followReader(host: HTMLElement): void {
  const links = new Map<string, HTMLAnchorElement>();
  host.querySelectorAll<HTMLAnchorElement>('.toc a[data-id]').forEach((a) => links.set(a.dataset.id ?? '', a));
  const mark = (id: string): void => {
    for (const [key, a] of links) {
      if (key === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  };
  if (typeof IntersectionObserver === 'undefined') return;
  const seen = new Set<string>();
  const chapters = [...host.querySelectorAll<HTMLElement>('.chapter')];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target.id);
        else seen.delete(entry.target.id);
      }
      // The first (topmost) chapter in the band is the one being read.
      const first = chapters.find((chapter) => seen.has(chapter.id));
      if (first) mark(first.id);
    },
    { root: host, rootMargin: '-12% 0px -78% 0px' },
  );
  chapters.forEach((chapter) => observer.observe(chapter));
  mark(chapters[0]?.id ?? '');
}
