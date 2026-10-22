'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out waiting for extension state.');
}
exports.run = async function () {
  const ext = vscode.extensions.getExtension('mengcz-sdu.vul-tools'); assert.ok(ext);
  const api = await ext.activate();
  assert.equal(ext.packageJSON.displayName, 'VUL Tools');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vul-tools-host-'));
  const file = vscode.Uri.file(path.join(dir, 'Sample.vul'));
  const contents = 'INTERFACE() { QUERY(value, uint32_t); }\nREGISTER(count,uint32_t);\nQUERY(value,uint32_t) { return count; }';
  await fs.writeFile(file.fsPath, contents);
  await fs.writeFile(path.join(dir, 'header.hpp'), 'CONFIG(WIDTH,32); ALIAS(Word,uint32_t);');
  try {
    const document = await vscode.workspace.openTextDocument(file);
    assert.equal(document.languageId, 'vul');
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('vul-tools.refresh');
    assert.equal(vscode.languages.getDiagnostics(file).length, 0);
    const colored = await api.highlightCode('const int answer = 42; // comment', document);
    assert.ok(colored?.lines[0].length > 1, 'real installed C++ grammar must tokenize the code');
    assert.ok(new Set(colored.lines[0].map(token => token.color)).size > 1, 'active theme must provide token colors');
    const config = vscode.workspace.getConfiguration('editor');
    const originalColors = config.inspect('tokenColorCustomizations')?.globalValue;
    try {
      await config.update('tokenColorCustomizations', { comments: '#12AB34' }, vscode.ConfigurationTarget.Global);
      await until(async () => {
        const result = await api.highlightCode('// customized comment', document);
        return result?.lines[0].some(token => token.color?.toUpperCase() === '#12AB34');
      });
    } finally { await config.update('tokenColorCustomizations', originalColors, vscode.ConfigurationTarget.Global); }

    await vscode.commands.executeCommand('vul-tools.openVisual');
    await until(() => api.getSnapshot(file)?.result);
    await until(() => api.getProjectSnapshot(file)?.files.length === 1 && !api.getProjectSnapshot(file).stale);
    assert.equal(api.getProjectSnapshot(file).root, vscode.Uri.file(dir).toString());
    assert.equal(api.getProjectSnapshot(file).files[0].result.components[0].name, 'WIDTH');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(file, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'REGISTER(renamed,uint32_t);');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(document.isDirty, true);
    assert.equal(api.getSnapshot(file).stale, true);
    await vscode.commands.executeCommand('vul-tools.refresh');
    assert.equal(api.getSnapshot(file).result.components[0].name, 'renamed');
    assert.equal(api.getSnapshot(file).version, document.version);
    assert.equal(document.isDirty, true, 'visual refresh must never save or rewrite source');
    await vscode.commands.executeCommand('vul-tools.openSource');
    await until(() => vscode.window.activeTextEditor?.document === document);
    assert.equal(document.getText(), 'REGISTER(renamed,uint32_t);');
    const invalid = new vscode.WorkspaceEdit(); invalid.insert(file, document.positionAt(document.getText().length), '\nREGISTER(broken);');
    await vscode.workspace.applyEdit(invalid);
    await until(() => vscode.languages.getDiagnostics(file).some(d => d.message.includes('missing required')));
    await document.save();
    assert.equal(api.getSnapshot(file).stale, false);
    const headerFile = vscode.Uri.file(path.join(dir, 'header.hpp'));
    await fs.writeFile(headerFile.fsPath, 'CONFIG(WIDTH,32); ALIAS(Word,uint32_t);');
    const header = await vscode.workspace.openTextDocument(headerFile);
    await vscode.window.showTextDocument(header);
    assert.equal(header.languageId, 'cpp'); assert.equal(vscode.languages.getDiagnostics(header.uri).length, 0);
    // Header buffers remain C++, while project refresh reads their unsaved contents.
    const headerEdit = new vscode.WorkspaceEdit();
    headerEdit.replace(header.uri, new vscode.Range(header.positionAt(0), header.positionAt(header.getText().length)), 'CONFIG(WIDTH,64); ALIAS(Broken);');
    await vscode.workspace.applyEdit(headerEdit);
    assert.equal(api.getProjectSnapshot(file).stale, true);
    await vscode.commands.executeCommand('vul-tools.refresh', file);
    await until(() => !api.getProjectSnapshot(file).stale && api.getProjectSnapshot(file).files[0].dirty);
    assert.equal(api.getProjectSnapshot(file).files[0].result.components[0].attributes[1].value, '64');
    await until(() => vscode.languages.getDiagnostics(header.uri).some(d => d.message.includes('missing required')));
    assert.match(await fs.readFile(headerFile.fsPath, 'utf8'), /32/);
    const fixHeader = new vscode.WorkspaceEdit();
    fixHeader.replace(header.uri, new vscode.Range(header.positionAt(0), header.positionAt(header.getText().length)), 'CONFIG(WIDTH,128);');
    await vscode.workspace.applyEdit(fixHeader); await header.save();
    await until(() => !api.getProjectSnapshot(file).stale && api.getProjectSnapshot(file).files[0].result.components[0].attributes[1].value === '128');
    await until(() => vscode.languages.getDiagnostics(header.uri).length === 0);

    // PROJECT rebinds to a recursive Header directory, preserving module syntax checks.
    const projectDir = path.join(dir, 'directory-project');
    await fs.mkdir(path.join(projectDir, 'header', 'nested'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'header', 'types.hpp'), 'ALIAS(LocalWord,uint64_t);');
    await fs.writeFile(path.join(projectDir, 'header', 'nested', 'types.hpp'), 'CONFIG(DEPTH,8);');
    const bindingEdit = new vscode.WorkspaceEdit();
    bindingEdit.replace(file, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'PROJECT("directory-project"); INTERFACE() {}');
    await vscode.workspace.applyEdit(bindingEdit);
    await vscode.commands.executeCommand('vul-tools.refresh', file);
    await until(() => api.getProjectSnapshot(file)?.root === vscode.Uri.file(projectDir).toString() && !api.getProjectSnapshot(file).stale);
    assert.deepEqual(api.getProjectSnapshot(file).files.map(f => f.filename), ['nested/types.hpp', 'types.hpp']);
    assert.equal(vscode.languages.getDiagnostics(file).length, 0);
    const addedHeader = path.join(projectDir, 'header', 'added.h');
    await fs.writeFile(addedHeader, 'CONFIG(ADDED,1);');
    await until(() => !api.getProjectSnapshot(file).stale && api.getProjectSnapshot(file).files.length === 3);
    await fs.unlink(addedHeader);
    await until(() => !api.getProjectSnapshot(file).stale && api.getProjectSnapshot(file).files.length === 2);
    await document.save();
    const mainFile = vscode.Uri.file(path.join(dir, 'Main.utb'));
    await fs.writeFile(mainFile.fsPath, 'SIMULATION() {}');
    const main = await vscode.workspace.openTextDocument(mainFile);
    assert.equal(main.languageId, 'vul-testbench');
    await vscode.window.showTextDocument(main); await vscode.commands.executeCommand('vul-tools.refresh');
    assert.equal(vscode.languages.getDiagnostics(main.uri).length, 0);
    assert.equal(await fs.readFile(file.fsPath, 'utf8'), document.getText());
    console.log('VUL Tools extension-host acceptance passed.');
  } finally {
    for (let i = 0; i < 20 && vscode.window.tabGroups.all.some(group => group.tabs.length); i++) {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
};
