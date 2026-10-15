'use strict';
const { buildExample } = require('./build-example.cjs');
try { for (const name of ['querydemo', 'prodcon', 'array1d']) buildExample(name); }
catch (error) { console.error(error); process.exitCode = 1; }
