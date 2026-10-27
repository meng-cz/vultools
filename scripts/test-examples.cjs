'use strict';
const assert = require('node:assert/strict');
const { buildExample } = require('./build-example.cjs');
const expected = {
  querydemo: Array.from({ length: 4 }, (_, i) => `${2 * i + 1}: querydemo output=${6 * i + 3}`),
  prodcon: Array.from({ length: 10 }, (_, i) => `${2 * i}: Output: ${i * (i - 1)}`),
  array1d: ['array1d tick=0 data=9']
};
try {
  for (const [name, lines] of Object.entries(expected)) {
    const output = buildExample(name).trim().split(/\r?\n/);
    assert.deepEqual(output, lines, `${name}: unexpected simulation output`);
  }
} catch (error) { console.error(error); process.exitCode = 1; }
