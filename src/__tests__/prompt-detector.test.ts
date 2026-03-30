/**
 * Tests for prompt detector — findArrayEnd
 */

import { describe, it, expect } from 'vitest';
import { findArrayEnd } from '../scanners/prompts/detector.js';

describe('findArrayEnd', () => {
  it('finds end of array with nested objects', () => {
    const lines = [
      'const messages = [',
      '  { role: "system", content: "You are helpful" },',
      '  { role: "user", content: "Hello" },',
      '];',
      'console.log("done");',
    ];
    // Line 0 contains the opening [, line 3 contains the closing ]
    expect(findArrayEnd(lines, 0)).toBe(3);
  });

  it('finds end of empty array on same line', () => {
    const lines = ['const messages = [];'];
    // Opening [ and closing ] are on the same line (0)
    expect(findArrayEnd(lines, 0)).toBe(0);
  });

  it('handles deeply nested objects', () => {
    const lines = [
      'const messages = [',
      '  { role: "system", content: { text: "deep" } },',
      '];',
    ];
    // Line 2 contains the closing ]
    expect(findArrayEnd(lines, 0)).toBe(2);
  });

  it('falls back to startLine + 50 for unclosed array', () => {
    const lines = ['const messages = [', '  "item"'];
    // No closing ], fallback = min(0 + 50, 2 - 1) = 1
    expect(findArrayEnd(lines, 0)).toBe(1);
  });

  it('does not confuse } closing with ] closing', () => {
    // Regression test for the depth bug: a closing } must not cause
    // the subsequent ] check to fire at the wrong depth.
    const lines = [
      'messages = [',
      '  { role: "user" },',
      '  { role: "assistant" },',
      '];',
    ];
    expect(findArrayEnd(lines, 0)).toBe(3);
  });

  it('handles strings containing brackets without affecting depth', () => {
    const lines = [
      'const messages = [',
      '  { role: "user", content: "say [hello] and {world}" },',
      '];',
    ];
    expect(findArrayEnd(lines, 0)).toBe(2);
  });

  it('handles array starting on a non-zero line', () => {
    const lines = [
      'const x = 1;',
      'const messages = [',
      '  { role: "user", content: "hi" },',
      '];',
    ];
    // startLine is 1
    expect(findArrayEnd(lines, 1)).toBe(3);
  });

  it('handles array with multiple deeply nested levels', () => {
    const lines = [
      '[',
      '  { a: { b: { c: 1 } } },',
      ']',
    ];
    expect(findArrayEnd(lines, 0)).toBe(2);
  });
});
