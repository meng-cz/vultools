'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
exports.run = async function () {
  const directory = process.env.VUL_WEBVIEW_TEST_DIR;
  if (!directory) throw Error('Run through npm run test:webview.');
  const extension = vscode.extensions.getExtension('mengcz-sdu.vul-tools');
  const api = await extension.activate();
  const registers = prefix => Array.from({ length: 60 }, (_, i) => `REGISTER(${prefix}${i},uint32_t);`).join('\n');
  await fs.writeFile(path.join(directory, 'header.uh'), Array.from({ length: 40 }, (_, i) => `CONFIG(C${i},${i});`).join('\n'));
  const uri = vscode.Uri.file(path.join(directory, 'Scroll.vul'));
  await fs.writeFile(uri.fsPath, `INTERFACE() { ${Array.from({ length: 30 }, (_, i) => `PARAMETER(P${i},${i});`).join('\n')} }\nUSE_VERSION(a);\nVERSION(a) { ${registers('a')} }\nVERSION(b) { ${registers('b')} }`);
  await fs.writeFile(path.join(directory, 'Main.utb'), Array.from({length:60},(_,i)=>`CONFIG(M${i},${i});`).join('\n')+'\nSIMULATION() {}');
  await vscode.workspace.openTextDocument(uri);
  await vscode.commands.executeCommand('vul-tools.openVisual', uri);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (let i = 0; i < 200 && !api.getProjectSnapshot(uri)?.files.length; i++) await wait(50);
    if (!api.getProjectSnapshot(uri)?.files.length) throw Error('Project fixture did not load.');
    await fs.writeFile(path.join(directory, 'ready'), 'ready');
    let opened = 'module', resized = false;
    for (let i = 0; i < 900; i++) {
      try {
        const request = JSON.parse(await fs.readFile(path.join(directory, 'open.json'), 'utf8'));
        if (request.kind !== opened) {
          const filename = {header:'header.uh',testbench:'Main.utb'}[request.kind];
          if (!filename) throw Error('Unknown Webview fixture phase.');
          await vscode.commands.executeCommand('vul-tools.openVisual', vscode.Uri.file(path.join(directory, filename)));
          opened = request.kind;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try {
        await fs.access(path.join(directory, 'resize.json'));
        if (!resized) { await vscode.commands.executeCommand('workbench.actions.view.problems'); resized = true; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try {
        const result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
        if (result.error) throw Error(result.error);
        console.log('VUL Tools real Webview scrolling acceptance passed.');
        return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await wait(100);
    }
    throw Error('Timed out waiting for Webview input verification.');
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
};
