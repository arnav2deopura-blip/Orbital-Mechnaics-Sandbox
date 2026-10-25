import { describe, expect, it } from 'vitest';
import { isPageHash, learnHref, parseRoute, rewriteHref } from '../src/app/router';

describe('parseRoute', () => {
  it('reads the Learn page and its sections', () => {
    expect(parseRoute('#/learn')).toEqual({ page: 'learn', section: '' });
    expect(parseRoute('#/learn/chaos')).toEqual({ page: 'learn', section: 'chaos' });
    expect(parseRoute('#/learn/preset-figure-eight')).toEqual({ page: 'learn', section: 'preset-figure-eight' });
  });

  it('leaves every other hash to the simulator', () => {
    for (const hash of ['', '#', '#/', '#s=abc', '#preset=lagrange&mass=40', '#/learner', '#learn']) {
      expect(parseRoute(hash)).toEqual({ page: 'sim' });
    }
  });

  it('survives a broken escape', () => {
    expect(parseRoute('#/learn/100%')).toEqual({ page: 'learn', section: '100%' });
  });
});

describe('learnHref', () => {
  it('round-trips through parseRoute', () => {
    expect(learnHref()).toBe('#/learn');
    expect(parseRoute(learnHref('time-reversal'))).toEqual({ page: 'learn', section: 'time-reversal' });
  });
});

describe('isPageHash', () => {
  it('tells a page address from a run', () => {
    expect(isPageHash('#/learn/chaos')).toBe(true);
    expect(isPageHash('#/')).toBe(true);
    expect(isPageHash('#preset=kepler')).toBe(false);
    expect(isPageHash('#s=abc')).toBe(false);
    expect(isPageHash('')).toBe(false);
  });
});

describe('rewriteHref', () => {
  it('turns the two-page links into links inside the page', () => {
    expect(rewriteHref('learn.html')).toBe('#/learn');
    expect(rewriteHref('learn.html#wisdom-holman')).toBe('#/learn/wisdom-holman');
    expect(rewriteHref('./learn.html#chaos')).toBe('#/learn/chaos');
    expect(rewriteHref('index.html#preset=figure-eight')).toBe('#preset=figure-eight');
    expect(rewriteHref('index.html')).toBe('#/');
  });

  it('leaves other links alone', () => {
    expect(rewriteHref('https://example.org/learn.html')).toBe('https://example.org/learn.html');
    expect(rewriteHref('#chaos')).toBe('#chaos');
    expect(rewriteHref('x.html')).toBe('x.html');
  });
});
