/* The webview renders text only. No source text is used as HTML or executed. */
'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let snapshot, selected = vscode.getState()?.selected;
const element = (tag, text, parent, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
};
const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children)]);
function attributes(title, attributes, parent) {
  if (!attributes.length) return;
  element('h3', title, parent);
  const table = element('table', undefined, parent), head = element('tr', undefined, element('thead', undefined, table));
  for (const label of ['Parameter', 'Value', 'Source']) element('th', label, head);
  const body = element('tbody', undefined, table);
  for (const attr of attributes) {
    const row = element('tr', undefined, body);
    for (const text of [attr.name, attr.value, attr.explicit ? 'Explicit' : 'Default / inferred']) element('td', text, row);
  }
}
function detail(node) {
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
    const pre = element('pre', undefined, pane); element('code', block.code, pre);
  }
  if (!blocks) element('p', 'No code block.', pane, 'muted');
  const issues = snapshot.result.issues.filter(i => i.start >= node.start && i.start < node.end);
  if (issues.length) {
    element('h3', 'Declaration issues', pane);
    for (const issue of issues) element('p', issue.message, pane, issue.severity);
  }
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
    for (const node of members) {
      const button = element('button', `${node.kind} · ${node.name}${node.selected ? ' ✓ selected' : ''}`, section, 'component');
      button.type = 'button'; button.dataset.id = node.id; button.setAttribute('aria-pressed', String(node.id === selected));
      button.addEventListener('click', () => detail(node));
      if (node.children.length) list(node.children, element('div', undefined, section, 'children'), hasInterface, false);
    }
  }
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type !== 'snapshot' || !message.result) return;
  if (snapshot && snapshot.uri === message.uri && message.currentVersion < snapshot.currentVersion) return;
  snapshot = message;
  byId('filename').textContent = message.filename;
  byId('status').textContent = message.stale ? 'Out of date — refresh to inspect the current document.' : `${message.dirty ? 'Unsaved document' : 'Saved document'} · ${message.result.issues.length} declaration issue(s) · Read-only visual view`;
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
