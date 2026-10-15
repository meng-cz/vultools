import * as vscode from 'vscode';
import { parse as parseJson } from 'jsonc-parser';
import { IRawGrammar, IRawTheme, parseRawGrammar } from 'vscode-textmate';
import { CppHighlighter, HighlightResult } from './highlight';
type IRawThemeSetting = IRawTheme['settings'][number];
interface Contribution { scopeName: string; path: string }
interface ThemeContribution { id?: string; label?: string; path: string }
interface ThemeFile { include?: string; colors?: Record<string, string>; tokenColors?: IRawThemeSetting[] | string; settings?: IRawThemeSetting[] }
const shortcuts: Record<string, string[]> = {
  comments: ['comment'], strings: ['string'], numbers: ['constant.numeric'], keywords: ['keyword', 'storage'],
  types: ['entity.name.type', 'support.type', 'support.class'], functions: ['entity.name.function', 'support.function'], variables: ['variable']
};
export class SyntaxService implements vscode.Disposable {
  private cached = new Map<string, Promise<CppHighlighter>>();
  private generation = 0;
  constructor(private extensionUri: vscode.Uri, private output: vscode.OutputChannel) {}
  invalidate(): void {
    this.generation++;
    for (const promise of this.cached.values()) void promise.then(value => value.dispose(), () => {});
    this.cached.clear();
  }
  dispose(): void { this.invalidate(); }
  private async read(uri: vscode.Uri): Promise<string> { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); }
  private async theme(uri: vscode.Uri, seen = new Set<string>()): Promise<ThemeFile> {
    if (seen.has(uri.toString()) || seen.size > 16) return {};
    seen.add(uri.toString());
    const text = await this.read(uri);
    const current = uri.path.endsWith('.tmTheme') ? parseRawGrammar(text, uri.path) as unknown as ThemeFile : parseJson(text) as ThemeFile;
    let base: ThemeFile = {};
    if (current.include) base = await this.theme(vscode.Uri.joinPath(uri, '..', current.include), seen);
    let tokenColors = current.tokenColors;
    if (typeof tokenColors === 'string') tokenColors = (await this.theme(vscode.Uri.joinPath(uri, '..', tokenColors), seen)).tokenColors ?? [];
    return { colors: { ...base.colors, ...current.colors }, tokenColors: [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...(Array.isArray(tokenColors) ? tokenColors : current.settings ?? [])] };
  }
  private customizationRules(custom: Record<string, unknown>): IRawThemeSetting[] {
    const rules: IRawThemeSetting[] = [];
    for (const [name, scope] of Object.entries(shortcuts)) {
      const setting = custom[name];
      if (typeof setting === 'string') rules.push({ scope, settings: { foreground: setting } });
      else if (setting && typeof setting === 'object') rules.push({ scope, settings: setting as IRawThemeSetting['settings'] });
    }
    if (Array.isArray(custom.textMateRules)) rules.push(...custom.textMateRules as IRawThemeSetting[]);
    return rules;
  }
  private async create(doc: vscode.TextDocument): Promise<CppHighlighter> {
    const extensions = [...vscode.extensions.all].sort((a, b) => Number(b.id === 'ms-vscode.cpptools') - Number(a.id === 'ms-vscode.cpptools'));
    const grammars = new Map<string, vscode.Uri>();
    const themes: Array<{ contribution: ThemeContribution; uri: vscode.Uri }> = [];
    for (const extension of extensions) {
      for (const grammar of extension.packageJSON.contributes?.grammars ?? [] as Contribution[]) {
        if (!grammars.has(grammar.scopeName)) grammars.set(grammar.scopeName, vscode.Uri.joinPath(extension.extensionUri, grammar.path));
      }
      for (const contribution of extension.packageJSON.contributes?.themes ?? [] as ThemeContribution[]) {
        themes.push({ contribution, uri: vscode.Uri.joinPath(extension.extensionUri, contribution.path) });
      }
    }
    // UI-only theme extensions can be unavailable on a remote extension host.
    const name = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', 'Default Dark Modern');
    const dark = [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind);
    const selected = themes.find(theme => [theme.contribution.id, theme.contribution.label].includes(name))
      ?? themes.find(theme => theme.contribution.id === (dark ? 'Default Dark Modern' : 'Default Light Modern'));
    const raw = selected ? await this.theme(selected.uri) : {};
    const settings: IRawThemeSetting[] = [{ settings: { foreground: raw.colors?.['editor.foreground'] ?? (dark ? '#D4D4D4' : '#000000') } }, ...(Array.isArray(raw.tokenColors) ? raw.tokenColors : [])];
    const custom = vscode.workspace.getConfiguration('editor', { uri: doc.uri, languageId: 'cpp' }).get<Record<string, unknown>>('tokenColorCustomizations', {});
    settings.push(...this.customizationRules(custom));
    for (const [selector, value] of Object.entries(custom)) {
      if (!selector.startsWith('[') || !value || typeof value !== 'object') continue;
      const matches = [...selector.matchAll(/\[([^\]]+)\]/g)].some(match => {
        const pattern = match[1].split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp(`^${pattern}$`).test(name);
      });
      if (matches) settings.push(...this.customizationRules(value as Record<string, unknown>));
    }
    const wasm = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.extensionUri, 'media', 'onig.wasm'));
    return CppHighlighter.create(wasm, async scope => {
      const uri = grammars.get(scope);
      return uri ? parseRawGrammar(await this.read(uri), uri.path) as IRawGrammar : null;
    }, { settings });
  }
  async highlight(code: string, doc: vscode.TextDocument): Promise<HighlightResult | undefined> {
    const generation = this.generation;
    const key = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() ?? 'default';
    let highlighter = this.cached.get(key);
    if (!highlighter) { highlighter = this.create(doc); this.cached.set(key, highlighter); }
    try {
      const instance = await highlighter;
      return generation === this.generation ? instance.highlight(code) : undefined;
    } catch (error) { this.output.appendLine(`C++ syntax highlighting: ${String(error)}`); return undefined; }
  }
}
