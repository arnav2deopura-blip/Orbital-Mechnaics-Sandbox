import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs TypeScript tests in a DOM-free Node environment', () => {
    expect(typeof document).toBe('undefined');
    expect(new Float64Array(9)).toHaveLength(9);
  });
});
