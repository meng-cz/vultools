#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const known = { querydemo: 'Top.vul', prodcon: 'TopModule.vul', array1d: 'Top.vul' };
function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
  if (capture && result.stdout) process.stdout.write(result.stdout);
  return result.stdout;
}
function buildExample(name, sdkArg) {
  if (!Object.hasOwn(known, name)) throw new Error(`Unknown example '${name}'. Choose ${Object.keys(known).join(', ')}.`);
  const project = path.join(root, 'install', 'example', name);
  const sdk = path.resolve(sdkArg || process.env.VUL_SDK || path.join(root, 'install'));
  for (const file of ['vulsimgen', 'vullib']) if (!fs.existsSync(path.join(sdk, file))) throw new Error(`Missing SDK ${file}: set VUL_SDK or pass the SDK directory.`);
  const output = path.join(project, 'build', 'simout');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Some SDK distributions retain legacy .hpp/.cpp beside migrated sources.
  // The current generator rejects these; isolate the migrated project without
  // deleting or renaming any files in the installed SDK.
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'vul-tools-example-'));
  try {
    function copySources(directory, destination) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name), target = path.join(destination, entry.name);
        if (entry.isDirectory() && entry.name !== 'build' && !entry.name.startsWith('.')) {
          fs.mkdirSync(target, { recursive: true }); copySources(source, target);
        } else if (entry.isFile() && /\.(uh|vul|utb)$/.test(entry.name)) fs.copyFileSync(source, target);
      }
    }
    copySources(project, staged);
    run(path.join(sdk, 'vulsimgen'), ['-m', path.join(staged, 'Main.utb'), '-t', path.join(staged, known[name]), '-p', staged, '-l', path.join(sdk, 'vullib'), '-o', output, '-f'], staged);
    run(process.env.CXX || 'g++', ['-std=c++20', '-O2', '-g', path.join(output, 'main.cpp'), '-I', output, '-o', path.join(output, 'Main')], project);
    return run(path.join(output, 'Main'), [], project, true);
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
}
module.exports = { buildExample };
if (require.main === module) {
  try { buildExample(process.argv[2] || 'querydemo', process.argv[3]); }
  catch (error) { console.error(`VUL Tools: ${error.message}`); process.exitCode = 1; }
}
