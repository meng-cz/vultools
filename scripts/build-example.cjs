#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const known = { querydemo: 'Top.vul', prodcon: 'TopModule.vul', array1d: 'Top.vul' };
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
}
function buildExample(name, sdkArg) {
  if (!Object.hasOwn(known, name)) throw new Error(`Unknown example '${name}'. Choose ${Object.keys(known).join(', ')}.`);
  const project = path.join(root, 'examples', name);
  const sdk = path.resolve(sdkArg || process.env.VUL_SDK || path.join(root, 'install'));
  for (const file of ['vulsimgen', 'vullib']) if (!fs.existsSync(path.join(sdk, file))) throw new Error(`Missing SDK ${file}: set VUL_SDK or pass the SDK directory.`);
  const output = path.join(project, 'build', 'simout');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  run(path.join(sdk, 'vulsimgen'), ['-m', path.join(project, 'Main.utb'), '-t', path.join(project, known[name]), '-p', project, '-l', path.join(sdk, 'vullib'), '-o', output, '-f'], project);
  run(process.env.CXX || 'g++', ['-std=c++20', '-O2', '-g', path.join(output, 'main.cpp'), '-I', output, '-o', path.join(output, 'Main')], project);
  run(path.join(output, 'Main'), [], project);
}
module.exports = { buildExample };
if (require.main === module) {
  try { buildExample(process.argv[2] || 'querydemo', process.argv[3]); }
  catch (error) { console.error(`VUL Tools: ${error.message}`); process.exitCode = 1; }
}
