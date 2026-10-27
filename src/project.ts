import { Component, ParseResult, parse } from './parser';
import { tokenize } from './parser/lexer';

/** URI operations and reads are supplied by the host, never by local Node fs. */
export interface ProjectIO {
  parent(uri: string): string;
  join(uri: string, path: string): string;
  resolve(base: string, path: string): string;
  stat(uri: string): Promise<'file' | 'directory' | undefined>;
  entries(uri: string): Promise<Array<[string, 'file' | 'directory' | 'other']>>;
  source(uri: string): Promise<{ text: string; version: number; dirty: boolean }>;
}
export interface HeaderResult {
  uri: string; filename: string; version: number; dirty: boolean;
  result?: ParseResult; lineStarts?: number[]; error?: string;
}
export interface ProjectResult {
  root?: string; mode?: 'file' | 'directory'; files: HeaderResult[];
  stale: boolean; revision: number; messages: string[];
}
export interface ProjectLocation { root?: string; searched: string[]; error?: string }

export async function locateProject(io: ProjectIO, moduleUri: string, components: Component[], setting: string, workspace?: string): Promise<ProjectLocation> {
  const parent = io.parent(moduleUri);
  const explicit = setting.trim();
  if (explicit) {
    if (!explicit.startsWith('/') && !workspace) return { searched: [], error: 'Relative projectRoot requires a workspace folder.' };
    return { root: io.resolve(workspace ?? parent, explicit), searched: [] };
  }
  const declarations = components.filter(c => c.kind === 'PROJECT');
  if (declarations.length) {
    const raw = declarations[0].attributes.find(a => a.name === 'path')?.value;
    const tokens = tokenize(raw ?? '').tokens;
    const value = tokens.length === 1 && tokens[0].kind === 'literal' ? tokens[0].text : undefined;
    if (declarations.length !== 1 || !value || !/^"(?:[^"\\]|\\.)*"$/.test(value)) {
      return { searched: [], error: 'PROJECT requires exactly one declaration with a string literal path.' };
    }
    let path: string;
    try { path = JSON.parse(value); } catch { return { searched: [], error: 'Invalid PROJECT path string literal.' }; }
    if (!path || path.includes('\0')) return { searched: [], error: 'PROJECT path must not be empty or contain NUL.' };
    return { root: io.resolve(parent, path), searched: [] };
  }
  const searched: string[] = [];
  let dir = parent;
  for (;;) {
    searched.push(dir);
    const entries = await Promise.all(['header', 'header.uh'].map(name => io.stat(io.join(dir, name))));
    if (entries.some(Boolean)) return { root: dir, searched };
    const next = io.parent(dir);
    if (next === dir) return { searched };
    dir = next;
  }
}

/** Cache immutable per-file parses by exact source; a failed read never hides other files. */
export class HeaderParser {
  private cache = new Map<string, { text: string; result: ParseResult; lineStarts: number[] }>();
  async load(io: ProjectIO, root: string): Promise<ProjectResult> {
    const output: ProjectResult = { root, files: [], stale: false, revision: 0, messages: [] };
    const files: Array<[string, string]> = [];
    const seen = new Set<string>();
    try {
      if (await io.stat(root) !== 'directory') throw new Error('Project root is not a readable directory.');
      const names = ['header', 'header.uh'];
      const kinds = await Promise.all(names.map(name => io.stat(io.join(root, name))));
      if (kinds.filter(Boolean).length > 1) throw new Error('Conflicting Header layout: use only header/ or header.uh.');
      const index = kinds.findIndex(Boolean);
      if (index < 0) throw new Error('No header/ or header.uh found in the selected project.');
      output.mode = index === 0 ? 'directory' : 'file';
      if (index === 0) {
        if (kinds[0] !== 'directory') throw new Error('header must be a directory.');
        const visit = async (dir: string, prefix: string): Promise<void> => {
          try {
            for (const [name, kind] of await io.entries(dir)) {
              const uri = io.join(dir, name), relative = prefix + name;
              if (kind === 'directory') await visit(uri, relative + '/');
              else if (kind === 'file' && /\.uh$/.test(name)) files.push([uri, relative]);
            }
          } catch (error) { output.messages.push(`Cannot read ${prefix || 'header/'}: ${String(error)}`); }
        };
        await visit(io.join(root, 'header'), '');
      } else {
        if (kinds[index] !== 'file') throw new Error(`${names[index]} must be a file.`);
        files.push([io.join(root, names[index]), names[index]]);
      }
      files.sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      for (const [uri, filename] of files) {
        seen.add(uri);
        try {
          const source = await io.source(uri);
          let cached = this.cache.get(uri);
          if (!cached || cached.text !== source.text) {
            cached = { text: source.text, result: parse(source.text, 'header'), lineStarts: [0, ...Array.from(source.text.matchAll(/\r\n|\r|\n/g), match => match.index! + match[0].length)] }; this.cache.set(uri, cached);
          }
          output.files.push({ uri, filename, version: source.version, dirty: source.dirty, result: cached.result, lineStarts: cached.lineStarts });
        } catch (error) { output.files.push({ uri, filename, version: -1, dirty: false, error: String(error) }); }
      }
    } catch (error) { output.messages.push(String(error)); }
    for (const uri of this.cache.keys()) if (!seen.has(uri)) this.cache.delete(uri);
    return output;
  }
}
