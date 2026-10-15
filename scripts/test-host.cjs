'use strict';
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '..');
// VS Code terminals can inherit Electron's Node mode; the test host needs the GUI runtime.
delete process.env.ELECTRON_RUN_AS_NODE;
runTests({
  version: process.env.VSCODE_TEST_VERSION || '1.95.3',
  vscodeExecutablePath: process.env.VSCODE_TEST_EXECUTABLE || undefined,
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'tests', 'host', 'index.cjs'),
  launchArgs: [path.join(root, 'examples', 'querydemo'), '--no-sandbox', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', ...(process.env.VSCODE_HEADLESS === '1' ? ['--ozone-platform=headless'] : [])]
}).catch(error => { console.error(error); process.exitCode = 1; });
