import { Registry, IGrammar, IRawGrammar, IRawTheme, StateStack } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
export interface HighlightToken { start: number; end: number; color?: string }
export interface HighlightResult { lines: HighlightToken[][] }
let wasmReady: Promise<void> | undefined;
/** TextMate coloring only: never compiles, executes, or changes the source. */
export class CppHighlighter {
  private constructor(private registry: Registry, private grammar: IGrammar) {}
  static async create(wasm: Uint8Array, loader: (scope: string) => Promise<IRawGrammar | null>, theme: IRawTheme): Promise<CppHighlighter> {
    wasmReady ??= loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
    await wasmReady;
    const registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner: patterns => new OnigScanner(patterns), createOnigString: text => new OnigString(text) }),
      loadGrammar: loader, theme
    });
    try {
      const grammar = await registry.loadGrammar('source.cpp');
      if (!grammar) throw new Error('No C++ TextMate grammar is available.');
      return new CppHighlighter(registry, grammar);
    } catch (error) { registry.dispose(); throw error; }
  }
  highlight(code: string): HighlightResult {
    const colors = this.registry.getColorMap();
    let stack: StateStack | null = null;
    const lines = code.split('\n').map(line => {
      const result = this.grammar.tokenizeLine2(line, stack, 20);
      stack = result.ruleStack;
      const tokens: HighlightToken[] = [];
      for (let i = 0; i < result.tokens.length; i += 2) {
        const start = result.tokens[i], end = Math.min(line.length, result.tokens[i + 2] ?? line.length);
        const color = colors[(result.tokens[i + 1] >>> 15) & 0x1ff];
        if (start < end) tokens.push({ start, end, color: /^#[\da-f]{3,8}$/i.test(color ?? '') ? color : undefined });
      }
      return tokens;
    });
    return { lines };
  }
  dispose(): void { this.registry.dispose(); }
}
