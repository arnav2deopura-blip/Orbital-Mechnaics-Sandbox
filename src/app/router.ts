// Two pages in one document: the simulator and the Learn page, told apart by the hash.
//
// `#/learn` and `#/learn/<section>` are the Learn page. Everything else is the simulator, which
// keeps the hash for itself: `#s=...` and `#preset=...` are runs (urlState.ts), and the simulator
// ignores any hash that starts with `#/`. The hash, not the path, because the build is a plain
// static site that may sit at any sub-path (vite.config.ts, `base: './'`), and because Back and
// Forward then move between the pages with no code of ours.

export type Route = { page: 'sim' } | { page: 'learn'; section: string };

const LEARN = '/learn';

export function parseRoute(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text !== LEARN && !text.startsWith(`${LEARN}/`)) return { page: 'sim' };
  const raw = text.slice(LEARN.length + 1);
  let section = raw;
  try {
    section = decodeURIComponent(raw);
  } catch {
    // a stray percent sign: use it as written
  }
  return { page: 'learn', section };
}

/** The link to the Learn page, or to one of its sections (a chapter id, or `preset-<id>`). */
export function learnHref(section = ''): string {
  return section ? `#${LEARN}/${encodeURIComponent(section)}` : `#${LEARN}`;
}

/** The link to the simulator. */
export const SIM_HREF = '#/';

/** True when the hash is a page address rather than a run, so the simulator must not read it as one. */
export function isPageHash(hash: string): boolean {
  return (hash.startsWith('#') ? hash.slice(1) : hash).startsWith('/');
}

/**
 * Links written for two separate pages (the Learn chapters say `index.html#preset=x`, the first
 * versions of the app said `learn.html#chaos`) become links inside the one page. Anything else,
 * an external address for one, is left alone.
 */
export function rewriteHref(href: string): string {
  const learn = /^(?:\.\/)?learn\.html(?:#(.*))?$/.exec(href);
  if (learn) return learnHref(learn[1] ?? '');
  const sim = /^(?:\.\/)?index\.html(?:#(.*))?$/.exec(href);
  if (sim) return sim[1] ? `#${sim[1]}` : SIM_HREF;
  return href;
}

/** Calls back with the route now and each time it changes. Returns the way to stop. */
export function onRoute(callback: (route: Route) => void): () => void {
  const listener = (): void => callback(parseRoute(location.hash));
  window.addEventListener('hashchange', listener);
  listener();
  return () => window.removeEventListener('hashchange', listener);
}
