import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// fileURLToPath (not URL.pathname) so paths containing spaces are decoded correctly.
const page = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  // Relative asset URLs: the build works on any static host or sub-path (hosting target is still open, plan §15.4).
  base: './',
  // Multi-page app: unknown routes are 404s, not an index.html fallback. `/learn` serves learn.html.
  appType: 'mpa',
  build: {
    target: 'es2023',
    rolldownOptions: {
      input: {
        main: page('index.html'),
        learn: page('learn.html'),
      },
    },
  },
  test: {
    // sim/ is DOM-free by design (plan §2), so tests run in plain Node.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Convergence and long-run conservation tests (plan §10) outlast the 5 s default.
    testTimeout: 30_000,
    restoreMocks: true,
  },
});
