import { Component, FileKind, Issue, ParseResult, flatten } from './model';
import { Token, tokenize } from './lexer';
import { Rule, endpoints, headerKinds, rules, testbenchKinds } from './rules';
export * from './model';

const connectionFields: Record<string, [string[], string[]]> = {
  CONNECT_CR_CS: [['srcchild', 'srcreq'], ['dstchild', 'dstserv']],
  CONNECT_CR_S: [['srcchild', 'srcreq'], ['dstserv']],
  CONNECT_CR_R: [['srcchild', 'srcreq'], ['dstreq']],
  CONNECT_S_CS: [['srcserv'], ['dstchild', 'dstserv']]
};

export function parse(source: string, fileKind: FileKind = 'module'): ParseResult {
  return new Parser(source, fileKind).run();
}

class Parser {
  private tokens: Token[];
  private issues: Issue[];
  constructor(private source: string, private fileKind: FileKind) {
    const lexed = tokenize(source); this.tokens = lexed.tokens; this.issues = lexed.issues;
  }
  private error(token: Token | Component, message: string, severity: Issue['severity'] = 'error'): void {
    this.issues.push({ start: token.start, end: Math.max(token.start + 1, token.end), message, severity });
  }
  private raw(tokens: Token[]): string {
    return tokens.length ? this.source.slice(tokens[0].start, tokens.at(-1)!.end).trim() : '';
  }
  private clean(tokens: Token[]): string { return tokens.map(t => t.text).join(''); }
  private matching(index: number, limit: number): number {
    // C++ bodies are opaque: only braces delimit them; incomplete C++
    // parentheses/brackets inside must not become declaration diagnostics.
    if (this.tokens[index]?.text === '{') {
      let depth = 0;
      for (let i = index; i < limit; i++) {
        const token = this.tokens[i];
        if (token.kind === 'literal' || token.kind === 'directive') continue;
        if (token.text === '{') depth++;
        if (token.text === '}' && --depth === 0) return i;
      }
      return -1;
    }
    const pairs: Record<string, string> = { '(': ')', '[': ']' };
    const stack: string[] = [];
    for (let i = index; i < limit; i++) {
      const t = this.tokens[i];
      if (t.kind === 'literal' || t.kind === 'directive') continue;
      if (t.text === '{') {
        const close = this.matching(i, limit);
        if (close < 0) return -1;
        i = close; continue;
      }
      if (pairs[t.text]) stack.push(pairs[t.text]);
      else if ([')', ']', '}'].includes(t.text)) {
        if (stack.pop() !== t.text) return -1;
        if (!stack.length) return i;
      }
    }
    return -1;
  }
  // Only type fields treat angle brackets as delimiters. Comparisons and shifts
  // in expression fields must never swallow the following API argument.
  private split(tokens: Token[], rule?: Rule): Token[][] {
    if (!tokens.length) return [];
    const result: Token[][] = []; let current: Token[] = [], depth = 0, angle = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.text === '{' && token.kind === 'symbol') {
        let braces = 1; current.push(token);
        while (++i < tokens.length) {
          const bodyToken = tokens[i]; current.push(bodyToken);
          if (bodyToken.kind !== 'symbol') continue;
          if (bodyToken.text === '{') braces++;
          if (bodyToken.text === '}' && --braces === 0) break;
        }
        continue;
      }
      const field = current[1]?.text === '=' ? current[0].text : rule?.fields[result.length];
      const typeField = field === 'type';
      if (token.kind !== 'literal') {
        if (['(', '[', '{'].includes(token.text)) depth++;
        if ([')', ']', '}'].includes(token.text)) depth--;
        if (depth === 0 && typeField && token.text === '<') angle++;
        if (depth === 0 && typeField && token.text === '>' && angle) angle--;
      }
      if (token.text === ',' && token.kind === 'symbol' && depth === 0 && angle === 0) {
        result.push(current); current = [];
      } else current.push(token);
    }
    result.push(current); return result;
  }
  private allowed(kind: string, scope: string): boolean {
    if (endpoints.has(kind)) return scope === 'PIPELINE';
    if (scope === 'PIPELINE') return false;
    if (scope === 'INTERFACE') return ['PARAMETER', 'REQUEST', 'SERVICE', 'QUERY'].includes(kind);
    if (scope === 'VERSION') return !['PARAMETER', 'REQUEST', 'INTERFACE', 'VERSION', 'USE_VERSION', 'TOP', 'PROJECT', 'GLOBAL', 'SIMULATION'].includes(kind);
    if (this.fileKind === 'header') return headerKinds.has(kind);
    if (this.fileKind === 'testbench') return testbenchKinds.has(kind);
    return !['TOP', 'GLOBAL', 'SIMULATION'].includes(kind);
  }
  private arguments(node: Component, tokens: Token[], rule: Rule): void {
    let position = 0, named = false, tail = false;
    const seen = new Set<string>();
    for (const part of this.split(tokens, rule)) {
      if (!part.length) { this.error(node, `${node.kind}: empty argument.`); continue; }
      const text = this.raw(part), compact = this.clean(part);
      if (['ARG', 'RESP'].includes(part[0].text) && rule.tail === 'business') {
        tail = true;
        const opening = this.tokens.indexOf(part[1]);
        const close = part[1]?.text === '(' ? this.matching(opening, this.tokens.indexOf(part.at(-1)!) + 1) : -1;
        const closePart = close < 0 ? -1 : part.indexOf(this.tokens[close]);
        if (closePart < 3 || part.length !== closePart + 2 || part.at(-1)?.kind !== 'id') {
          this.error(part[0], `${node.kind}: expected ARG(Type) name or RESP(Type) name.`);
        } else {
          const name = part.at(-1)!.text;
          if (node.parameters.some(p => p.name === name)) this.error(part[0], `Duplicate business parameter '${name}'.`);
          node.parameters.push({ direction: part[0].text as 'ARG' | 'RESP', type: this.raw(part.slice(2, closePart)), name });
        }
        continue;
      }
      if (part[0].text === 'PARAM' && rule.tail === 'overrides') {
        tail = true;
        const match = /^PARAM\(([A-Za-z_]\w*)\)=(.+)$/.exec(compact);
        if (!match) this.error(part[0], 'Expected PARAM(name)=expression or PARAM(name)=COORD(dimension).');
        else {
          if (node.overrides.some(a => a.name === match[1])) this.error(part[0], `Duplicate parameter override '${match[1]}'.`);
          const equals = part.findIndex(t => t.text === '=');
          const value = this.raw(part.slice(equals + 1));
          if (value.startsWith('COORD') && !/^COORD\(.+\)$/.test(this.clean(part.slice(equals + 1)))) this.error(part[0], 'COORD requires a dimension expression.');
          node.overrides.push({ name: match[1], value, explicit: true });
        }
        continue;
      }
      if (rule.tail === 'endpoints' && endpoints.has(part[0].text)) {
        tail = true;
        const index = this.tokens.indexOf(part[0]), limit = this.tokens.indexOf(part.at(-1)!) + 1;
        const parsed = this.declaration(index, limit, 'PIPELINE', node.condition);
        if (parsed) {
          node.children.push(parsed.node);
          if (parsed.next < limit) this.error(this.tokens[parsed.next], 'Unexpected text after pipeline endpoint.');
        }
        continue;
      }
      if (tail) this.error(part[0], `${node.kind}: attributes must precede trailing declarations.`);
      const isNamed = part[0].kind === 'id' && part[1]?.text === '=' && part[2]?.text !== '=';
      let field: string | undefined, value: string;
      if (isNamed) { named = true; field = part[0].text; value = this.raw(part.slice(2)); }
      else {
        if (named) this.error(part[0], `${node.kind}: positional argument after named argument.`);
        field = rule.fields[position++]; value = text;
      }
      if (!field || !rule.fields.includes(field)) { this.error(part[0], `${node.kind}: unknown or excess argument '${field ?? text}'.`); continue; }
      if (seen.has(field)) this.error(part[0], `${node.kind}: duplicate attribute '${field}'.`);
      seen.add(field);
      if (!value) this.error(part[0], `${node.kind}: '${field}' cannot be empty.`);
      node.attributes.push({ name: field, value, explicit: true });
    }
    for (const field of rule.fields) {
      if (!seen.has(field)) {
        if (rule.defaults && field in rule.defaults) node.attributes.push({ name: field, value: rule.defaults[field], explicit: false });
        else if (!rule.optional?.includes(field)) this.error(node, `${node.kind}: missing required attribute '${field}'.`);
      }
    }
    const attr = (key: string) => node.attributes.find(a => a.name === key);
    const canonical = (value: string) => tokenize(value).tokens.map(t => t.text).join('');
    const connection = connectionFields[node.kind];
    node.name = connection
      ? connection.map(fields => fields.map(field => attr(field)?.value || '?').join('.')).join(' → ')
      : canonical(attr('name')?.value || attr('alias')?.value || '') || node.kind;
    for (const field of ['name', 'alias', 'module', 'service', 'query']) {
      if (attr(field) && !/^[A-Za-z_]\w*$/.test(canonical(attr(field)!.value))) this.error(node, `${node.kind}: '${field}' must be an identifier.`);
    }
    if (node.kind === 'PROJECT' && this.fileKind === 'module' && attr('path')) {
      try {
        const tokens = tokenize(attr('path')!.value).tokens;
        const path = tokens.length === 1 && tokens[0].kind === 'literal' ? JSON.parse(tokens[0].text) : undefined;
        if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error();
      } catch { this.error(node, 'PROJECT path must be a nonempty string literal without NUL.'); }
    }
    if (attr('handshake') && !['true', 'false', '1', '0'].includes(canonical(attr('handshake')!.value))) this.error(node, 'handshake must be true, false, 1 or 0.');
    if (attr('dims')?.explicit) {
      const dims = canonical(attr('dims')!.value);
      if (!/^\[[\s\S]*\]$/.test(dims) || !this.singleDimensionList(dims)) this.error(node, 'dims must use [N0, N1, ...].');
      else if (dims.slice(1, -1).trim()) {
        const dimsTokens = tokenize(dims.slice(1, -1)).tokens;
        for (const dim of this.split(dimsTokens)) {
          const val = dim.map(t => t.text).join('');
          if (!val || /^-?\d+$/.test(val) && Number(val) <= 0) this.error(node, 'Each dimension must be a nonempty positive constant expression.');
        }
      }
    }
    if (node.kind === 'BRAM') {
      if (!['generic', '1rw'].includes(canonical(attr('mode')?.value ?? 'generic'))) this.error(node, 'BRAM mode must be generic or 1rw.');
      if (canonical(attr('mode')?.value ?? '') === '1rw') for (const port of ['read_ports', 'write_ports']) {
        if (/^\d+$/.test(attr(port)!.value) && Number(attr(port)!.value) !== 1) this.error(node, 'BRAM 1rw requires one read and one write port.');
      }
    }
    for (const key of ['ports', 'read_ports', 'write_ports', 'depth', 'size', 'latency', 'enq_width', 'deq_width', 'data_width']) {
      const value = attr(key)?.value;
      if (value && /^-?\d+$/.test(value) && Number(value) <= 0) this.error(node, `${key} must be positive.`);
    }
    if (node.kind === 'PIPELINE') {
      const input = node.children.filter(c => c.kind === 'IVALID'), output = node.children.filter(c => c.kind === 'OVALID');
      if (input.length > 1 || output.length > 1 || !!input.length !== !!output.length) this.error(node, 'Pipeline IVALID and OVALID must be unique and paired.');
      if (!node.children.some(c => c.kind === 'OREG')) this.error(node, 'PIPELINE requires an OREG output.');
    }
  }
  private singleDimensionList(value: string): boolean {
    const tokens = tokenize(value).tokens; let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].text === '[') depth++;
      if (tokens[i].text === ']' && --depth === 0 && i !== tokens.length - 1) return false;
    }
    return depth === 0;
  }
  private declaration(index: number, limit: number, scope: string, condition?: string): { node: Component; next: number } | undefined {
    const token = this.tokens[index], rule = rules[token.text];
    if (!rule) return undefined;
    const node: Component = { id: `${token.text}:${token.start}`, kind: token.text, name: token.text, category: rule.category, start: token.start, end: token.end, attributes: [], parameters: [], overrides: [], codeBlocks: [], children: [], condition, relatedIds: [] };
    if (!this.allowed(node.kind, scope)) this.error(node, `${node.kind} is not allowed in ${scope || this.fileKind} scope.`);
    const close = this.matching(index + 1, limit);
    if (close < 0) {
      this.error(token, `${node.kind}: unclosed or mismatched argument list.`);
      let next = index + 2;
      while (next < limit && !(this.tokens[next].kind === 'id' && rules[this.tokens[next].text] && this.tokens[next + 1]?.text === '(' && this.source.slice(this.tokens[next - 1].end, this.tokens[next].start).includes('\n'))) next++;
      node.end = this.tokens[next - 1]?.end ?? token.end;
      return { node, next };
    }
    this.arguments(node, this.tokens.slice(index + 2, close), rule);
    let next = close + 1;
    const body = this.tokens[next]?.text === '{';
    if (body) {
      const bodyEnd = this.matching(next, limit);
      if (bodyEnd < 0) {
        this.error(this.tokens[next], `${node.kind}: unclosed or mismatched code block.`);
        node.codeBlocks.push({ role: 'incomplete', code: this.source.slice(this.tokens[next].start, this.tokens[limit - 1]?.end), start: this.tokens[next].start, end: this.tokens[limit - 1]?.end ?? this.source.length });
        node.end = this.tokens[limit - 1]?.end ?? token.end;
        return { node, next: limit };
      }
      if (!rule.body) this.error(token, `${node.kind} cannot have a code block.`);
      if (scope === 'INTERFACE') this.error(token, `${node.kind}: INTERFACE contains declarations only.`);
      if (rule.body === 'container') node.children = this.region(next + 1, bodyEnd, node.kind, condition);
      else node.codeBlocks.push({ role: node.kind === 'REGISTER' || node.kind === 'IREG' || node.kind === 'IVALID' ? 'reset' : 'implementation', code: this.source.slice(this.tokens[next].start, this.tokens[bodyEnd].end), start: this.tokens[next].start, end: this.tokens[bodyEnd].end });
      next = bodyEnd + 1;
      if (['STRUCT', 'ENUM'].includes(node.kind) && this.tokens[next]?.text !== ';') this.error(token, `${node.kind} requires a trailing semicolon.`);
    } else if (rule.body === 'required' || rule.body === 'container') this.error(token, `${node.kind} requires a code block.`);
    else if (this.tokens[next]?.text !== ';' && scope !== 'PIPELINE') this.error(token, `${node.kind} requires a semicolon or code block.`);
    if (node.kind === 'SERVICE') {
      const ready = node.attributes.find(a => a.name === 'ready'), handshake = node.attributes.find(a => a.name === 'handshake');
      if (ready) {
        if (!body) this.error(token, 'SERVICE forward declarations cannot have ready.');
        if (handshake?.explicit && ['false', '0'].includes(tokenize(handshake.value).tokens.map(t => t.text).join(''))) this.error(token, 'SERVICE ready conflicts with handshake=false.');
        if (handshake && !handshake.explicit) handshake.value = 'true';
      }
      if (body && ['true', '1'].includes(tokenize(handshake?.value ?? '').tokens.map(t => t.text).join('')) && !ready) this.error(token, 'Handshake SERVICE implementations require ready.');
    }
    if (node.kind === 'QUERY' && this.fileKind === 'testbench' && body) this.error(token, 'Testbench QUERY must be a declaration without a code block.');
    if (this.tokens[next]?.text === ';') next++;
    node.end = this.tokens[next - 1]?.end ?? token.end;
    return { node, next };
  }
  private region(start: number, limit: number, scope = '', inheritedCondition?: string): Component[] {
    const result: Component[] = [], conditions: string[] = [];
    for (let i = start; i < limit;) {
      const token = this.tokens[i];
      if (token.kind === 'directive') {
        const match = /^#\s*(if|ifdef|ifndef|elif|else|endif)\b([\s\S]*)/.exec(token.text);
        if (match) {
          if (['if', 'ifdef', 'ifndef'].includes(match[1])) conditions.push(`${match[1]} ${match[2].trim()}`);
          else if (match[1] === 'endif') conditions.pop();
          else if (conditions.length) conditions[conditions.length - 1] += ` / ${match[1]} ${match[2].trim()}`;
        }
        i++; continue;
      }
      const condition = [inheritedCondition, ...conditions].filter(Boolean).join(' / ') || undefined;
      if (token.kind === 'id' && rules[token.text] && this.tokens[i + 1]?.text !== '(') this.error(token, `${token.text} requires an argument list in parentheses.`);
      if (token.kind === 'id' && this.tokens[i + 1]?.text === '(') {
        const parsed = this.declaration(i, limit, scope, condition);
        if (parsed) { result.push(parsed.node); i = parsed.next; continue; }
        if (/^[A-Z][A-Z_0-9]+$/.test(token.text)) this.error(token, `Unknown VUL declaration '${token.text}'; custom macros are not expanded.`, 'warning');
      }
      // Unknown C++ constructs are opaque; never discover fake VUL components in their bodies.
      if (['{', '('].includes(token.text)) {
        const close = this.matching(i, limit); i = close >= 0 ? close + 1 : i + 1;
      } else i++;
    }
    return result;
  }
  private relationships(components: Component[]): void {
    const layout = components.filter(c => c.kind !== 'PROJECT');
    const all = flatten(components), interfaces = components.filter(c => c.kind === 'INTERFACE' && !c.condition);
    const versions = components.filter(c => c.kind === 'VERSION' && !c.condition);
    const selection = components.filter(c => c.kind === 'USE_VERSION' && !c.condition);
    const conditionalStructure = components.some(c => c.condition && ['INTERFACE', 'VERSION', 'USE_VERSION'].includes(c.kind));
    if (!conditionalStructure) {
      if (interfaces.length > 1) this.error(interfaces[1], 'Only one INTERFACE is allowed.');
      if (interfaces.length && layout[0] !== interfaces[0]) this.error(interfaces[0], 'INTERFACE must be the first declaration.');
      if (selection.length > 1) this.error(selection[1], 'Only one USE_VERSION is allowed.');
      if (selection.length) {
        if (!interfaces.length || layout[1] !== selection[0]) this.error(selection[0], 'USE_VERSION must immediately follow INTERFACE.');
        if (!versions.some(v => v.name === selection[0].name)) this.error(selection[0], `Selected version '${selection[0].name}' does not exist.`);
      } else if (versions.length) this.error(versions[0], 'VERSION requires USE_VERSION.');
    }
    if (selection.length === 1) for (const version of versions) version.selected = version.name === selection[0].name;
    const groups = [components, ...all.filter(c => c.kind === 'INTERFACE' || c.kind === 'VERSION' || c.kind === 'PIPELINE').map(c => c.children)];
    for (const group of groups) {
      const seen = new Map<string, Component>();
      const forms = new Set<string>();
      for (const c of group) {
        if (c.condition || ['TICK_IMPL', 'HELPER'].includes(c.kind) || c.kind.startsWith('CONNECT')) continue;
        const key = ['TOP', 'PROJECT', 'GLOBAL', 'SIMULATION', 'INTERFACE', 'USE_VERSION'].includes(c.kind) ? c.kind : c.kind === 'VERSION' ? `version:${c.name}` : c.name;
        const previous = seen.get(key);
        if (previous) {
          const pair = ['SERVICE', 'QUERY'].includes(c.kind) && c.kind === previous.kind && !!c.codeBlocks.length !== !!previous.codeBlocks.length && !forms.has(`${key}:${!!c.codeBlocks.length}`);
          if (!pair) this.error(c, `Duplicate declaration '${c.name}'.`);
          else this.link(previous, c);
        } else seen.set(key, c);
        forms.add(`${key}:${!!c.codeBlocks.length}`);
      }
    }
    const interfaceNodes = interfaces.flatMap(c => c.children);
    const implementations = versions.length ? versions.map(v => v.children) : [components.filter(c => !['INTERFACE', 'USE_VERSION'].includes(c.kind))];
    if (interfaces.length && !conditionalStructure) for (const implementation of implementations) {
      for (const c of implementation) {
        if (c.condition) continue;
        if (['PARAMETER', 'REQUEST'].includes(c.kind)) this.error(c, `${c.kind} belongs in INTERFACE.`);
        if (['SERVICE', 'QUERY'].includes(c.kind)) {
          const decl = interfaceNodes.find(d => d.name === c.name && d.kind === c.kind);
          if (!decl) this.error(c, `${c.kind} '${c.name}' is not declared in INTERFACE.`);
          else this.link(decl, c);
        }
      }
    }
  }
  private link(decl: Component, impl: Component): void {
    decl.relatedIds.push(impl.id); impl.relatedIds.push(decl.id);
    const normalize = (value: string) => tokenize(value).tokens.map(t => t.text).join(' ');
    const signature = (c: Component) => JSON.stringify({
      parameters: c.parameters.map(p => ({ ...p, type: normalize(p.type) })),
      attributes: c.attributes.filter(a => ['type', 'dims', 'handshake'].includes(a.name)).map(a => [a.name,
        a.name === 'handshake' ? ['true', '1'].includes(normalize(a.value)) : normalize(a.value)]).sort()
    });
    const priority = decl.attributes.find(a => a.name === 'priority' && a.explicit);
    const implPriority = impl.attributes.find(a => a.name === 'priority' && a.explicit);
    if (priority && (!implPriority || normalize(priority.value) !== normalize(implPriority.value))) this.error(impl, 'SERVICE implementation must repeat the declared priority.');
    if (signature(decl) !== signature(impl)) this.error(impl, `${impl.kind} '${impl.name}' declaration and implementation signatures differ.`);
  }
  run(): ParseResult {
    const components = this.region(0, this.tokens.length);
    this.relationships(components);
    return { fileKind: this.fileKind, components, issues: this.issues };
  }
}
