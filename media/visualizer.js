/* The webview renders text only. No source text is used as HTML or executed. */
'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let snapshot, selected = vscode.getState()?.selected;
const drafts = new Map();
let editorOptions = { tabSize: 4 };
let nextHighlightId = 0;
const highlightRequests = new Map();
const element = (tag, text, parent, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
};
const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children)]);
function configureEditor(options) {
  if (!options) return;
  editorOptions = options;
  const style = document.documentElement.style;
  if (typeof options.fontFamily === 'string') style.setProperty('--vul-code-font-family', options.fontFamily);
  if (typeof options.fontWeight === 'string') style.setProperty('--vul-code-font-weight', options.fontWeight);
  if (Number.isFinite(options.fontSize)) style.setProperty('--vul-code-font-size', `${options.fontSize}px`);
  if (Number.isFinite(options.lineHeight)) style.setProperty('--vul-code-line-height', options.lineHeight > 8 ? `${options.lineHeight}px` : options.lineHeight > 0 ? String(options.lineHeight) : '1.5');
  if (Number.isInteger(options.tabSize)) style.setProperty('--vul-code-tab-size', String(options.tabSize));
}
function codeBody(block) {
  let code = block.code;
  if (block.role !== 'incomplete' && code.startsWith('{') && code.endsWith('}')) code = code.slice(1, -1);
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const tabSize = Number.isInteger(editorOptions.tabSize) && editorOptions.tabSize > 0 ? editorOptions.tabSize : 4;
  const indentWidth = line => {
    let width = 0;
    for (const char of line.match(/^[\t ]*/)[0]) width += char === '\t' ? tabSize - width % tabSize : 1;
    return width;
  };
  const nonempty = lines.filter(line => line.trim());
  const common = nonempty.length ? Math.min(...nonempty.map(indentWidth)) : 0;
  return lines.map(line => line.trim() ? ' '.repeat(indentWidth(line) - common) + line.replace(/^[\t ]*/, '') : '').join('\n').trimEnd();
}
function requestHighlight(editor, backdrop) {
  if (!editor.isConnected) return;
  const old = Number(editor.dataset.highlightRequest);
  highlightRequests.delete(old);
  editor.parentElement.classList.remove('is-highlighted');
  const requestId = ++nextHighlightId;
  editor.dataset.highlightRequest = String(requestId);
  highlightRequests.set(requestId, { editor, backdrop, code: editor.value });
  vscode.postMessage({ type: 'highlight', requestId, code: editor.value });
}
function applyHighlight(message) {
  const pending = highlightRequests.get(message.requestId);
  highlightRequests.delete(message.requestId);
  if (!pending || !pending.editor.isConnected || pending.editor.value !== pending.code || !message.result?.lines) return;
  const { editor, backdrop, code } = pending;
  backdrop.replaceChildren();
  code.split('\n').forEach((line, index) => {
    let end = 0;
    for (const token of message.result.lines[index] || []) {
      if (token.start < end || token.end < token.start || token.end > line.length) continue;
      if (token.start > end) backdrop.append(document.createTextNode(line.slice(end, token.start)));
      const span = element('span', line.slice(token.start, token.end), backdrop);
      if (/^#[\da-f]{3,8}$/i.test(token.color || '')) span.style.color = token.color;
      end = token.end;
    }
    backdrop.append(document.createTextNode(line.slice(end) + '\n'));
  });
  editor.parentElement.classList.add('is-highlighted');
  backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft;
}
function attributes(title, attributes, parent) {
  if (!attributes.length) return;
  element('h3', title, parent);
  const table = element('table', undefined, parent), head = element('tr', undefined, element('thead', undefined, table));
  for (const label of ['Parameter', 'Value', 'Source']) element('th', label, head);
  const body = element('tbody', undefined, table);
  for (const attr of attributes) {
    const row = element('tr', undefined, body);
    element('strong', attr.name, element('td', undefined, row));
    for (const text of [attr.value, attr.explicit ? 'Explicit' : 'Default / inferred']) element('td', text, row);
  }
}
function detail(node) {
  highlightRequests.clear();
  selected = node.id; vscode.setState({ selected });
  for (const button of byId('components').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.id === selected));
  const pane = byId('details'); pane.replaceChildren();
  element('h2', `${node.kind} · ${node.name}`, pane);
  const all = flatten(snapshot.result.components);
  const parent = all.find(n => n.children.some(child => child.id === node.id));
  if (parent) element('p', `Scope: ${parent.kind} ${parent.name}${parent.selected ? ' (selected version)' : ''}`, pane, 'muted');
  if (node.condition) element('p', `Conditional source (not evaluated): ${node.condition}`, pane, 'notice');
  attributes('API parameters', node.attributes, pane);
  attributes('Child parameter overrides', node.overrides, pane);
  if (node.parameters.length) {
    element('h3', 'Business parameters', pane);
    for (const param of node.parameters) element('pre', `${param.direction}(${param.type}) ${param.name}`, pane);
  }
  const related = node.relatedIds.map(id => all.find(n => n.id === id)).filter(Boolean);
  const entries = [node, ...related];
  if (related.length) element('p', `Linked declarations / implementations: ${related.map(n => n.name).join(', ')}`, pane, 'muted');
  let blocks = 0;
  for (const entry of entries) for (const block of entry.codeBlocks) {
    blocks++;
    const owner = all.find(n => n.children.some(child => child.id === entry.id));
    element('h3', `${block.role}${entry !== node ? ` · ${owner?.name || 'linked implementation'}` : ''}`, pane);
    element('p', 'Temporary edits only · not saved to source · refresh restores source', pane, 'muted code-note');
    const surface = element('div', undefined, pane, 'code-surface');
    const backdrop = element('pre', undefined, surface, 'code-highlight');
    backdrop.setAttribute('aria-hidden', 'true');
    const editor = element('textarea', undefined, surface, 'code-editor');
    const key = `${entry.id}:${block.start}`;
    editor.value = drafts.has(key) ? drafts.get(key) : codeBody(block);
    editor.rows = Math.min(30, Math.max(6, editor.value.split('\n').length + 1));
    editor.spellcheck = false; editor.wrap = 'off';
    editor.setAttribute('aria-label', `${entry.kind} ${entry.name} ${block.role} code (temporary edits)`);
    editor.setAttribute('autocapitalize', 'off');
    let timer;
    editor.addEventListener('input', () => {
      drafts.set(key, editor.value);
      editor.parentElement.classList.remove('is-highlighted');
      highlightRequests.delete(Number(editor.dataset.highlightRequest));
      clearTimeout(timer);
      timer = setTimeout(() => requestHighlight(editor, backdrop), 120);
    });
    editor.addEventListener('scroll', () => { backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; });
    requestHighlight(editor, backdrop);
  }
  if (!blocks) element('p', 'No code block.', pane, 'muted');
  const issues = snapshot.result.issues.filter(i => i.start >= node.start && i.start < node.end);
  if (issues.length) {
    element('h3', 'Declaration issues', pane);
    for (const issue of issues) element('p', issue.message, pane, issue.severity);
  }
}
function dimensionSuffix(value) {
  const dims = value.trim();
  if (!dims.startsWith('[') || !dims.endsWith(']')) return null;
  const body = dims.slice(1, -1);
  if (!body.trim()) return '';
  const parts = []; let start = 0, depth = 0, quote;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = undefined; continue; }
    if (body.startsWith('/*', i)) { const end = body.indexOf('*/', i + 2); if (end < 0) return null; i = end + 1; continue; }
    if (body.startsWith('//', i)) { const end = body.indexOf('\n', i + 2); if (end < 0) return null; i = end; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char) && --depth < 0) return null;
    if (char === ',' && !depth) { parts.push(body.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(body.slice(start).trim());
  return depth || quote || parts.some(part => !part) ? null : parts.map(part => `[${part}]`).join('');
}
function listType(node) {
  if (!['ALIAS', 'REGISTER', 'QUEUE', 'BRAM', 'WIRE', 'IREG', 'OREG', 'QUERY'].includes(node.kind)) return undefined;
  const type = node.attributes.find(attr => attr.name === 'type')?.value;
  if (!type) return undefined;
  const suffix = dimensionSuffix(node.attributes.find(attr => attr.name === 'dims')?.value ?? '[]');
  return { text: type + (suffix ?? ''), dimensionsRendered: suffix !== null };
}
function summary(node) {
  // CONNECT names already show both complete endpoints; repeating those fields
  // would obscure the direction of the connection.
  const type = listType(node);
  const signature = ['REQUEST', 'SERVICE'].includes(node.kind);
  const attributes = node.kind.startsWith('CONNECT_') ? [] : node.attributes.filter(attr =>
    attr.explicit && !['name', 'alias'].includes(attr.name) && !(signature && attr.name === 'handshake') && !(node.kind === 'PARAMETER' && attr.name === 'value') && !(type && (attr.name === 'type' || attr.name === 'dims' && type.dimensionsRendered)));
  return [
    ...attributes.map(attr => `${attr.name}=${attr.value}`),
    ...(signature ? [] : node.parameters.map(param => `${param.direction}(${param.type}) ${param.name}`)),
    ...node.overrides.filter(attr => attr.explicit).map(attr => `PARAM(${attr.name})=${attr.value}`)
  ].join(', ');
}
function component(node, parent, hasInterface) {
  const button = element('button', undefined, parent, 'component');
  element('strong', node.kind, button, 'component-kind');
  if (node.name !== node.kind || node.attributes.some(attr => ['name', 'alias'].includes(attr.name) && attr.explicit)) {
    element('span', ' · ', button);
    const name = element('strong', node.name, button, 'component-name');
    if (['REQUEST', 'SERVICE'].includes(node.kind)) {
      const parameters = node.parameters.map(param => `${param.type}${param.direction === 'RESP' ? ' &' : ''} ${param.name}`).join(', ');
      const handshake = node.attributes.find(attr => attr.name === 'handshake')?.value.trim();
      name.append(document.createTextNode(`(${parameters})${['true', '1'].includes(handshake) ? ' -> bool' : ''}`));
    }
    const type = listType(node);
    if (type) element('span', ['ALIAS', 'QUERY'].includes(node.kind) ? ` → ${type.text}` : `<${type.text}>`, name, 'component-type');
  }
  const value = node.kind === 'PARAMETER' && node.attributes.find(attr => attr.name === 'value');
  if (value) element('span', ` = ${value.value}`, button, 'component-value');
  const extra = summary(node);
  if (extra) element('span', ` ${extra}`, button, 'component-summary');
  if (node.selected) element('span', ' ✓ selected', button, 'selected-version');
  button.type = 'button'; button.dataset.id = node.id; button.setAttribute('aria-pressed', String(node.id === selected));
  button.addEventListener('click', () => detail(node));
  if (node.children.length) list(node.children, element('div', undefined, parent, 'children'), hasInterface, false);
}
function instanceReferences(node) {
  const fields = {
    USE_CHILD_SERVICE: ['instance'], USE_CHILD_QUERY: ['instance'],
    CONNECT_CR_CS: ['srcchild', 'dstchild'], CONNECT_CR_S: ['srcchild'],
    CONNECT_CR_R: ['srcchild'], CONNECT_S_CS: ['dstchild']
  }[node.kind] || [];
  // Group array endpoints by their declaration, without expanding instances.
  return new Set(fields.map(field => node.attributes.find(attr => attr.name === field)?.value.match(/^\s*([A-Za-z_]\w*)/)?.[1]).filter(Boolean));
}
function submodules(members, parent, hasInterface) {
  const children = members.filter(node => node.kind === 'CHILD_INSTANCE');
  const assigned = new Set(children.map(node => node.id));
  for (const child of children) {
    const group = element('section', undefined, parent, 'submodule');
    group.dataset.instance = child.name;
    component(child, element('h4', undefined, group), hasInterface);
    const related = members.filter(node => node.kind !== 'CHILD_INSTANCE' && instanceReferences(node).has(child.name));
    if (related.length) {
      const nested = element('div', undefined, group, 'children');
      for (const node of related) { component(node, nested, hasInterface); assigned.add(node.id); }
    }
  }
  // Keep incomplete declarations and unresolved references visible while editing.
  for (const node of members) if (!assigned.has(node.id)) component(node, parent, hasInterface);
}
function list(nodes, parent, hasInterface = false, root = true) {
  const interfaceBlocks = root ? nodes.filter(node => node.kind === 'INTERFACE') : [];
  hasInterface ||= interfaceBlocks.length > 0;
  const categories = new Map();
  // INTERFACE is a module-level section, not a selectable component. Put all
  // of its declarations directly under one heading, including parameters.
  if (interfaceBlocks.length) categories.set('Interfaces', interfaceBlocks.flatMap(node => node.children));
  else if (root && nodes.some(node => node.category === 'Interfaces')) categories.set('Interfaces', []);
  for (const node of nodes) {
    if (root && node.kind === 'INTERFACE') continue;
    const category = hasInterface && node.category === 'Interfaces' ? 'Implementations' : node.category;
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(node);
  }
  for (const [category, members] of categories) {
    const section = element('section', undefined, parent); element('h3', category, section);
    if (category === 'Submodules and Connections') submodules(members, section, hasInterface);
    else for (const node of members) component(node, section, hasInterface);
  }
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type === 'highlightResult') { applyHighlight(message); return; }
  if (message?.type === 'highlightThemeChanged') {
    for (const editor of document.querySelectorAll('.code-editor')) requestHighlight(editor, editor.parentElement.querySelector('.code-highlight'));
    return;
  }
  if (message?.type === 'editorSettings') { configureEditor(message.editorOptions); return; }
  if (message?.type !== 'snapshot' || !message.result) return;
  if (snapshot && snapshot.uri === message.uri && message.currentVersion < snapshot.currentVersion) return;
  if (!message.stale || snapshot?.uri !== message.uri) drafts.clear();
  configureEditor(message.editorOptions);
  snapshot = message;
  byId('filename').textContent = message.filename;
  byId('status').textContent = message.stale ? 'Out of date — refresh to inspect the current document.' : `${message.dirty ? 'Unsaved document' : 'Saved document'} · ${message.result.issues.length} declaration issue(s) · Code edits stay in this view`;
  byId('status').className = message.stale ? 'notice' : '';
  byId('components').replaceChildren(); list(message.result.components, byId('components'));
  if (!message.result.components.length) element('p', 'No recoverable VUL declarations.', byId('components'));
  const found = flatten(message.result.components).find(n => n.id === selected && n.kind !== 'INTERFACE');
  if (found) detail(found);
  else { selected = undefined; byId('details').replaceChildren(); element('p', 'Select a component to inspect its API parameters and C++ code.', byId('details')); }
  byId('issues').replaceChildren();
  if (message.result.issues.length) element('h2', 'Declaration diagnostics', byId('issues'));
  for (const issue of message.result.issues) element('p', `${issue.severity}: ${issue.message}`, byId('issues'), issue.severity);
});
byId('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
byId('source').addEventListener('click', () => vscode.postMessage({ type: 'source' }));
vscode.postMessage({ type: 'ready' });
