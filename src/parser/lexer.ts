import { Issue } from './model';
export interface Token { text: string; start: number; end: number; kind: 'id' | 'symbol' | 'literal' | 'directive' }
export function tokenize(source: string): { tokens: Token[]; issues: Issue[] } {
  const tokens: Token[] = [], issues: Issue[] = [];
  let i = 0;
  const add = (start: number, kind: Token['kind']) => tokens.push({ text: source.slice(start, i), start, end: i, kind });
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const start = i;
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) { issues.push({ start, end: source.length, message: 'Unterminated block comment.', severity: 'error' }); break; }
      i = end + 2; continue;
    }
    if (source[i] === '#' && /^\s*$/.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i))) {
      do { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; }
      while (i < source.length && /\\\r?\n$/.test(source.slice(start, i)));
      add(start, 'directive'); continue;
    }
    const raw = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/.exec(source.slice(i));
    if (raw) {
      const end = source.indexOf(')' + raw[1] + '"', i + raw[0].length);
      i = end < 0 ? source.length : end + raw[1].length + 2;
      if (end < 0) issues.push({ start, end: i, message: 'Unterminated raw string.', severity: 'error' });
      add(start, 'literal'); continue;
    }
    const quoted = /^(?:u8|u|U|L)?["']/.exec(source.slice(i));
    if (quoted) {
      const quote = quoted[0].at(-1)!; i += quoted[0].length;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') { i = Math.min(source.length, i + 2); continue; }
        if (source[i++] === quote) { closed = true; break; }
      }
      if (!closed) issues.push({ start, end: i, message: 'Unterminated string or character literal.', severity: 'error' });
      add(start, 'literal'); continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(i));
    if (identifier) { i += identifier[0].length; add(start, 'id'); continue; }
    const number = /^\d[\w'.]*/.exec(source.slice(i));
    if (number) { i += number[0].length; add(start, 'literal'); continue; }
    i++; add(start, 'symbol');
  }
  return { tokens, issues };
}
