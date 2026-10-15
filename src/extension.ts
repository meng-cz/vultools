import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { DocumentSession } from './session';
import { FileKind } from './parser';
import { SyntaxService } from './syntax';

export const viewType = 'vul-tools.visualizer';
export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection('VUL Tools');
  const output = vscode.window.createOutputChannel('VUL Tools');
  const syntax = new SyntaxService(context.extensionUri, output);
  const sessions = new Map<string, DocumentSession>();
  const panels = new Map<vscode.WebviewPanel, vscode.TextDocument>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let activePanel: vscode.WebviewPanel | undefined;
  const supported = (doc: vscode.TextDocument) => ['vul', 'vul-testbench'].includes(doc.languageId);
  const kind = (doc: vscode.TextDocument): FileKind => doc.languageId === 'vul-testbench' ? 'testbench' : 'module';
  function session(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    if (!sessions.has(key)) sessions.set(key, new DocumentSession());
    return sessions.get(key)!;
  }
  function publish(doc: vscode.TextDocument, state: DocumentSession) {
    if (!vscode.workspace.getConfiguration('vulTools', doc.uri).get('diagnostics.enabled', true) || state.stale || state.version !== doc.version) {
      diagnostics.delete(doc.uri); return;
    }
    diagnostics.set(doc.uri, (state.result?.issues ?? []).map(issue => {
      const diagnostic = new vscode.Diagnostic(new vscode.Range(doc.positionAt(issue.start), doc.positionAt(issue.end)), issue.message,
        issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      diagnostic.source = 'VUL Tools'; return diagnostic;
    }));
  }
  function notify(doc: vscode.TextDocument) {
    const state = session(doc);
    for (const [panel, document] of panels) if (document === doc) {
      void panel.webview.postMessage({ type: 'snapshot', uri: doc.uri.toString(), version: state.version, currentVersion: doc.version,
        stale: state.stale, dirty: doc.isDirty, filename: vscode.workspace.asRelativePath(doc.uri), result: state.result, editorOptions: editorOptions(doc) });
    }
  }
  function editorOptions(doc: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration('editor', doc);
    const textEditor = vscode.window.visibleTextEditors.find(editor => editor.document === doc);
    return {
      fontFamily: config.get<string>('fontFamily'), fontSize: config.get<number>('fontSize'),
      fontWeight: config.get<string>('fontWeight'), lineHeight: config.get<number>('lineHeight'),
      tabSize: typeof textEditor?.options.tabSize === 'number' ? textEditor.options.tabSize : config.get<number>('tabSize', 4)
    };
  }
  function refresh(doc: vscode.TextDocument) {
    if (!supported(doc)) return;
    const key = doc.uri.toString(), timer = timers.get(key);
    if (timer) { clearTimeout(timer); timers.delete(key); }
    const state = session(doc);
    try { state.refresh(doc.getText(), doc.version, kind(doc)); publish(doc, state); notify(doc); }
    catch (error) { state.stale = true; diagnostics.delete(doc.uri); output.appendLine(String(error)); notify(doc); }
  }
  function currentDocument(uri?: vscode.Uri): vscode.TextDocument | undefined {
    if (uri) return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (activePanel?.active) return panels.get(activePanel);
    return vscode.window.activeTextEditor?.document;
  }
  context.subscriptions.push(diagnostics, output, syntax,
    vscode.window.onDidChangeActiveColorTheme(() => {
      syntax.invalidate();
      for (const panel of panels.keys()) void panel.webview.postMessage({ type: 'highlightThemeChanged' });
    }),
    vscode.extensions.onDidChange(() => {
      syntax.invalidate();
      for (const panel of panels.keys()) void panel.webview.postMessage({ type: 'highlightThemeChanged' });
    }),
    vscode.window.registerCustomEditorProvider(viewType, {
      async resolveCustomTextEditor(doc, panel) {
        panels.set(panel, doc); activePanel = panel;
        const nonce = randomBytes(16).toString('hex');
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
        const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'visualizer.css'));
        const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'visualizer.js'));
        panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link href="${css}" rel="stylesheet"><title>VUL Tools</title></head><body><header><strong>VUL Tools</strong><span id="filename"></span><button id="source" type="button">Source View</button><button id="refresh" type="button">Refresh</button></header><p id="status" role="status">Loading declarations…</p><main><nav id="components" aria-label="VUL components"></nav><article id="details" aria-label="Component details"><p>Select a component to inspect its API parameters and C++ code.</p></article></main><section id="issues" aria-label="Declaration diagnostics"></section><script nonce="${nonce}" src="${js}"></script></body></html>`;
        panel.onDidChangeViewState(() => { if (panel.active) { activePanel = panel; if (session(doc).stale) refresh(doc); } }, undefined, context.subscriptions);
        panel.onDidDispose(() => { panels.delete(panel); if (activePanel === panel) activePanel = undefined; }, undefined, context.subscriptions);
        panel.webview.onDidReceiveMessage(async message => {
          if (!message || typeof message !== 'object') return;
          if (message.type === 'ready' || message.type === 'refresh') refresh(doc);
          if (message.type === 'source') void vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
          if (message.type === 'highlight' && Number.isSafeInteger(message.requestId) && typeof message.code === 'string' && message.code.length <= 200_000 && message.code.split('\n').length <= 3000) {
            const result = await syntax.highlight(message.code, doc);
            if (panels.has(panel)) void panel.webview.postMessage({ type: 'highlightResult', requestId: message.requestId, result });
          }
        }, undefined, context.subscriptions);
        refresh(doc);
      }
    }, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }),
    vscode.commands.registerCommand('vul-tools.openVisual', async (uri?: vscode.Uri) => {
      const document = currentDocument(uri);
      const target = uri ?? document?.uri;
      if (target?.path.endsWith('.vul')) await vscode.commands.executeCommand('vscode.openWith', target, viewType);
    }),
    vscode.commands.registerCommand('vul-tools.openSource', async () => {
      const document = currentDocument();
      if (document) await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
    }),
    vscode.commands.registerCommand('vul-tools.refresh', (uri?: vscode.Uri) => {
      const document = currentDocument(uri); if (document) refresh(document);
    }),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument(event => {
      const doc = event.document; if (!supported(doc) || !event.contentChanges.length) return;
      const key = doc.uri.toString(), state = session(doc);
      state.invalidate(doc.version); diagnostics.delete(doc.uri); notify(doc);
      // Visual snapshots are refreshed explicitly. Declaration diagnostics still debounce.
      const old = timers.get(key); if (old) clearTimeout(old);
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        if (doc.isClosed) return;
        // Keep an open visual snapshot stale until entry, save or explicit refresh.
        const visual = [...panels.values()].includes(doc);
        if (visual) {
          const checked = new DocumentSession(); checked.refresh(doc.getText(), doc.version, kind(doc)); publish(doc, checked);
        } else refresh(doc);
      }, 300));
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      const key = doc.uri.toString(); diagnostics.delete(doc.uri); sessions.delete(key);
      const timer = timers.get(key); if (timer) clearTimeout(timer); timers.delete(key);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('vulTools')) for (const doc of vscode.workspace.textDocuments) refresh(doc);
      for (const [panel, doc] of panels) {
        if (event.affectsConfiguration('editor', doc)) void panel.webview.postMessage({ type: 'editorSettings', editorOptions: editorOptions(doc) });
      }
      if (event.affectsConfiguration('editor.tokenColorCustomizations') || event.affectsConfiguration('workbench.colorTheme') || event.affectsConfiguration('[cpp]')) {
        syntax.invalidate();
        for (const panel of panels.keys()) void panel.webview.postMessage({ type: 'highlightThemeChanged' });
      }
    }),
    { dispose() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); sessions.clear(); panels.clear(); } }
  );
  for (const doc of vscode.workspace.textDocuments) refresh(doc);
  // Read-only inspection hook used by the extension-host regression suite.
  return { getSnapshot: (uri: vscode.Uri) => sessions.get(uri.toString()), highlightCode: (code: string, doc: vscode.TextDocument) => syntax.highlight(code, doc), viewType };
}
