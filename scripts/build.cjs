'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
buildSync({ entryPoints: [path.join(root, 'src/extension.ts')], bundle: true, platform: 'node', target: 'node20', format: 'cjs', mainFields: ['module', 'main'], external: ['vscode'], outfile: path.join(root, 'out/extension.js'), sourcemap: true });
fs.copyFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'), path.join(root, 'media/onig.wasm'));
const notices = ['vscode-textmate', 'vscode-oniguruma', 'jsonc-parser'].map(name => {
  const dir = path.dirname(require.resolve(`${name}/package.json`));
  const license = ['LICENSE.txt', 'LICENSE.md', 'LICENSE'].find(file => fs.existsSync(path.join(dir, file)));
  const extra = fs.existsSync(path.join(dir, 'NOTICES.txt')) ? fs.readFileSync(path.join(dir, 'NOTICES.txt'), 'utf8') : '';
  return `${name}\n${fs.readFileSync(path.join(dir, license), 'utf8')}\n${extra}`;
});
fs.writeFileSync(path.join(root, 'out/THIRD_PARTY_LICENSES.txt'), notices.join('\n\n'));
