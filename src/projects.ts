import * as vscode from 'vscode';
import { posix } from 'node:path';
import { Component, parse } from './parser';
import { HeaderParser, ProjectIO, ProjectResult, locateProject } from './project';

const key = (uri: vscode.Uri) => uri.toString();
const io: ProjectIO = {
  parent: uri => key(vscode.Uri.parse(uri).with({ path: posix.dirname(vscode.Uri.parse(uri).path) })),
  join: (uri, path) => key(vscode.Uri.joinPath(vscode.Uri.parse(uri), path)),
  resolve: (base, path) => key(vscode.Uri.parse(base).with({ path: posix.resolve(vscode.Uri.parse(base).path, path) })),
  async stat(uri) {
    try {
      const type = (await vscode.workspace.fs.stat(vscode.Uri.parse(uri))).type;
      // Do not follow symlinks when collecting recursive Headers.
      return type & vscode.FileType.Directory ? 'directory' : type & vscode.FileType.File ? 'file' : undefined;
    } catch (error) {
      if (error instanceof vscode.FileSystemError && ['FileNotFound', 'EntryNotFound'].includes(error.code)) return undefined;
      throw error;
    }
  },
  async entries(uri) {
    return (await vscode.workspace.fs.readDirectory(vscode.Uri.parse(uri))).map(([name, type]) => [name,
      type & vscode.FileType.SymbolicLink ? 'other' : type & vscode.FileType.Directory ? 'directory' : type & vscode.FileType.File ? 'file' : 'other']);
  },
  async source(uri) {
    const resource = vscode.Uri.parse(uri);
    const open = vscode.workspace.textDocuments.find(doc => key(doc.uri) === uri && !doc.isClosed);
    if (open) return { text: open.getText(), version: open.version, dirty: open.isDirty };
    return { text: Buffer.from(await vscode.workspace.fs.readFile(resource)).toString('utf8'), version: -1, dirty: false };
  }
};
interface Entry {
  result: ProjectResult; parser: HeaderParser; epoch: number;
  pending?: Promise<void>; watcher: vscode.FileSystemWatcher; timer?: ReturnType<typeof setTimeout>;
}
interface Binding { projectKey: string; document: vscode.TextDocument; root?: string; result?: ProjectResult; watchers: vscode.FileSystemWatcher[] }

/** Shared project snapshots; bindings and generation guards keep async work out of newer documents. */
export class ProjectService implements vscode.Disposable {
  private entries = new Map<string, Entry>();
  private bindings = new Map<string, Binding>();
  private sequence = 0;
  private disposed = false;
  private diagnostics = vscode.languages.createDiagnosticCollection('VUL Tools Headers');
  constructor(private changed: () => void, private ownsDiagnostics: (uri: string) => boolean = () => false) {}
  get(uri: vscode.Uri): ProjectResult | undefined {
    const binding = this.bindings.get(key(uri));
    return binding?.root ? this.entries.get(binding.root)?.result : binding?.result;
  }
  private watcher(root: string, callback: () => void) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.parse(root), '{header,header.uh,header/**}'));
    watcher.onDidCreate(callback); watcher.onDidChange(callback); watcher.onDidDelete(callback);
    return watcher;
  }
  async refresh(doc: vscode.TextDocument, components: Component[]): Promise<void> {
    if (this.disposed) return;
    const uri = key(doc.uri), previous = this.bindings.get(uri);
    const binding: Binding = { projectKey: this.projectKey(components), document: doc, root: previous?.root, result: previous?.result, watchers: [] };
    previous?.watchers.forEach(w => w.dispose());
    this.bindings.set(uri, binding);
    const version = doc.version;
    const current = () => !this.disposed && this.bindings.get(uri) === binding && doc.version === version && !doc.isClosed;
    try {
      const location = await locateProject(io, uri, components, vscode.workspace.getConfiguration('vulTools', doc.uri).get('projectRoot', ''), vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString());
      if (!current()) return;
      binding.root = location.root;
      binding.result = { files: [], stale: false, revision: ++this.sequence, messages: [location.error ?? 'No project Header found.'] };
      // Watch searched ancestors as well: creating a nearer project must rebind this module.
      binding.watchers = location.searched.filter(dir => dir !== location.root).map(dir => this.watcher(dir, () => {
        this.invalidateBinding(doc.uri);
        void this.refresh(doc, parse(doc.getText()).components);
      }));
      this.releaseUnused();
      if (location.root) {
        let entry = this.entries.get(location.root);
        if (!entry) {
          const root = location.root;
          entry = { result: { root, files: [], stale: true, revision: ++this.sequence, messages: ['Loading global declarations…'] }, parser: new HeaderParser(), epoch: 0,
            watcher: this.watcher(root, () => this.fileEvent(root)) };
          this.entries.set(root, entry);
        }
        this.changed();
        if (entry.pending) await entry.pending;
        if (current()) await this.load(location.root, entry);
      } else this.changed();
    } catch (error) {
      if (current()) { binding.root = undefined; binding.result = { files: [], stale: false, revision: ++this.sequence, messages: [String(error)] }; this.releaseUnused(); this.changed(); }
    }
  }
  private async load(root: string, entry: Entry): Promise<void> {
    if (entry.pending) return entry.pending;
    const epoch = entry.epoch;
    entry.pending = (async () => {
      const result = await entry.parser.load(io, root);
      if (this.disposed || this.entries.get(root) !== entry || epoch !== entry.epoch) return;
      // A source document can change during asynchronous filesystem reads.
      if (result.files.some(file => {
        const doc = vscode.workspace.textDocuments.find(d => key(d.uri) === file.uri);
        return file.result && doc && !doc.isClosed && file.version !== doc.version;
      })) { this.invalidateRoot(root, false); return; }
      entry.result = { ...result, revision: ++this.sequence };
      this.publishDiagnostics(); this.changed();
    })().catch(error => {
      if (this.entries.get(root) === entry && epoch === entry.epoch) {
        entry.result = { ...entry.result, stale: true, messages: [String(error)], revision: ++this.sequence }; this.changed();
      }
    }).finally(() => { entry.pending = undefined; });
    return entry.pending;
  }
  invalidateBinding(uri: vscode.Uri) {
    const binding = this.bindings.get(key(uri));
    if (!binding) return;
    // Cancel outstanding discovery; ordinary module edits do not invalidate shared Headers.
    this.bindings.set(key(uri), { ...binding });
  }
  private projectKey(components: Component[]): string {
    return JSON.stringify(components.filter(component => component.kind === 'PROJECT').map(component => component.attributes));
  }
  rebindIfChanged(doc: vscode.TextDocument, components: Component[]) {
    const binding = this.bindings.get(key(doc.uri));
    if (binding && (binding.projectKey !== this.projectKey(components) || !binding.root && !binding.result)) void this.refresh(doc, components);
  }
  private invalidateRoot(root: string, reload: boolean) {
    const entry = this.entries.get(root); if (!entry) return;
    entry.epoch++;
    entry.result = { ...entry.result, stale: true, revision: ++this.sequence };
    this.publishDiagnostics(); this.changed();
    if (reload) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { void (async () => { await entry.pending; if (this.entries.get(root) === entry) await this.load(root, entry); })(); }, 150);
    }
  }
  private fileEvent(root: string) {
    this.invalidateRoot(root, false);
    const entry = this.entries.get(root); if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      for (const binding of [...this.bindings.values()]) if (binding.root === root && !binding.document.isClosed) {
        void this.refresh(binding.document, parse(binding.document.getText()).components);
      }
    }, 150);
  }
  headerChanged(doc: vscode.TextDocument, saved: boolean) {
    const uri = key(doc.uri);
    for (const [root, entry] of this.entries) {
      const header = io.join(root, 'header');
      if (entry.result.files.some(file => file.uri === uri) || uri === io.join(root, 'header.uh') || uri.startsWith(header + '/') && uri.endsWith('.uh')) this.invalidateRoot(root, saved);
    }
  }
  publishDiagnostics() {
    this.diagnostics.clear();
    for (const entry of this.entries.values()) if (!entry.result.stale) for (const file of entry.result.files) {
      const uri = vscode.Uri.parse(file.uri);
      if (this.ownsDiagnostics(file.uri)) continue;
      if (!vscode.workspace.getConfiguration('vulTools', uri).get('diagnostics.enabled', true) || !file.result) continue;
      const positionAt = (offset: number) => {
        const starts = file.lineStarts ?? [0];
        let low = 0, high = starts.length;
        while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle; }
        return new vscode.Position(low, offset - starts[low]);
      };
      this.diagnostics.set(uri, file.result.issues.map(issue => {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(positionAt(issue.start), positionAt(issue.end)), issue.message,
          issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'VUL Tools'; return diagnostic;
      }));
    }
  }
  remove(uri: vscode.Uri) {
    const binding = this.bindings.get(key(uri)); binding?.watchers.forEach(w => w.dispose()); this.bindings.delete(key(uri)); this.releaseUnused();
  }
  private releaseUnused() {
    const roots = new Set([...this.bindings.values()].map(b => b.root));
    for (const [root, entry] of this.entries) if (!roots.has(root)) { clearTimeout(entry.timer); entry.watcher.dispose(); this.entries.delete(root); }
    this.publishDiagnostics();
  }
  dispose() {
    this.disposed = true;
    for (const binding of this.bindings.values()) binding.watchers.forEach(w => w.dispose());
    for (const entry of this.entries.values()) { clearTimeout(entry.timer); entry.watcher.dispose(); }
    this.entries.clear(); this.bindings.clear(); this.diagnostics.dispose();
  }
}
