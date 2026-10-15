'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { CppHighlighter } = require('../out/highlight');
test('TextMate uses theme colors and carries multiline C++ lexical state', async () => {
  const grammar = { scopeName: 'source.cpp', patterns: [
    { name: 'comment.line.cpp', match: '//.*$' },
    { name: 'comment.block.cpp', begin: '/\\*', end: '\\*/' },
    { name: 'string.quoted.cpp', begin: '"', end: '"' },
    { name: 'keyword.control.cpp', match: '\\b(?:if|return)\\b' },
    { name: 'constant.numeric.cpp', match: '\\b[0-9]+\\b' }
  ] };
  const theme = { settings: [
    { settings: { foreground: '#111111' } },
    { scope: 'comment', settings: { foreground: '#00AA00' } },
    { scope: 'string', settings: { foreground: '#AA7700' } },
    { scope: 'keyword', settings: { foreground: '#0000AA' } },
    { scope: 'constant.numeric', settings: { foreground: '#AA0000' } }
  ] };
  const highlighter = await CppHighlighter.create(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')), async scope => scope === 'source.cpp' ? grammar : null, theme);
  try {
    const code = 'if (ok) return 42; // comment\n/* first\nsecond */ "text"';
    const result = highlighter.highlight(code);
    const colors = result.lines[0].map(token => token.color.toUpperCase());
    assert.ok(colors.includes('#0000AA'));
    assert.ok(colors.includes('#AA0000'));
    assert.ok(colors.includes('#00AA00'));
    assert.equal(result.lines[2][0].color.toUpperCase(), '#00AA00');
    assert.ok(result.lines[2].some(token => token.color.toUpperCase() === '#AA7700'));
    for (const [i, line] of code.split('\n').entries()) {
      assert.equal(result.lines[i].map(token => line.slice(token.start,token.end)).join(''),line);
    }
  } finally { highlighter.dispose(); }
});
