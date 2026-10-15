'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parse } = require('../out/parser');
function setup() {
  const dom = new JSDOM('<header><span id="filename"></span><button id="source"></button><button id="refresh"></button></header><p id="status"></p><nav id="components"></nav><article id="details"></article><section id="issues"></section>', { runScripts: 'outside-only' });
  const messages = []; let state;
  dom.window.acquireVsCodeApi = () => ({ postMessage: message => messages.push(message), getState: () => state, setState: next => { state = next; } });
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../media/visualizer.js'),'utf8'));
  const send = (result, extras = {}) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'snapshot', uri: 'file:///Top.vul', filename: 'Top.vul', version: 1, currentVersion: 1, dirty: false, stale: false, result, ...extras } }));
  return { dom, messages, send, document: dom.window.document };
}
test('webview selection displays defaults and exact code as read-only text', () => {
  const ui = setup();
  try {
    const body = '{ auto html="<img src=x onerror=alert(1)>"; }';
    ui.send(parse(`REGISTER(counter, uint32_t) ${body}`));
    ui.document.querySelector('.component').click();
    assert.match(ui.document.querySelector('#details').textContent,/Default \/ inferred/);
    assert.equal(ui.document.querySelector('#details code').textContent, body);
    assert.equal(ui.document.querySelectorAll('img,input,textarea,[contenteditable]').length, 0);
    assert.deepEqual(ui.messages.map(m => m.type), ['ready']);
    ui.document.querySelector('#refresh').click(); ui.document.querySelector('#source').click();
    assert.deepEqual(ui.messages.map(m => m.type), ['ready','refresh','source']);
  } finally { ui.dom.window.close(); }
});
test('interface selection shows linked implementations with version ownership', () => {
  const ui = setup();
  try {
    ui.send(parse('INTERFACE() { QUERY(value,uint32_t); } USE_VERSION(fast); VERSION(fast) { QUERY(value,uint32_t) { return 2; } }'));
    const query = [...ui.document.querySelectorAll('.component')].find(b => b.textContent.startsWith('QUERY'));
    query.click();
    assert.match(ui.document.querySelector('#details').textContent,/return 2/);
    assert.match(ui.document.querySelector('#details').textContent,/fast/);
    assert.match(ui.document.querySelector('#components').textContent,/selected/);
  } finally { ui.dom.window.close(); }
});
test('INTERFACE declarations appear directly under a single top Interfaces heading', () => {
  const ui = setup();
  try {
    const result = parse('INTERFACE() { PARAMETER(WIDTH,32); REQUEST(out); SERVICE(push); QUERY(value,uint32_t); } USE_VERSION(fast); VERSION(fast) { REGISTER(count,uint32_t); SERVICE(push) {} QUERY(value,uint32_t) { return count; } }');
    // Presentation order must not depend on the position of the container.
    result.components.reverse();
    ui.send(result);
    const sections = ui.document.querySelector('#components').children;
    assert.equal(sections[0].querySelector('h3').textContent, 'Interfaces');
    assert.deepEqual([...sections[0].querySelectorAll('.component')].map(button => button.textContent), [
      'PARAMETER · WIDTH', 'REQUEST · out', 'SERVICE · push', 'QUERY · value'
    ]);
    assert.equal([...ui.document.querySelectorAll('#components h3')].filter(heading => heading.textContent === 'Interfaces').length, 1);
    assert.ok(![...ui.document.querySelectorAll('.component')].some(button => button.textContent.startsWith('INTERFACE')));
    sections[0].querySelectorAll('.component')[3].click();
    assert.match(ui.document.querySelector('#details').textContent, /return count/);
    assert.match(ui.document.querySelector('#components').textContent, /Implementations/);
  } finally { ui.dom.window.close(); }
});
test('empty INTERFACE has one heading and no selectable block', () => {
  const ui = setup();
  try {
    ui.send(parse('INTERFACE() {} REGISTER(count,uint32_t);'));
    const section = ui.document.querySelector('#components').firstElementChild;
    assert.equal(section.querySelector('h3').textContent, 'Interfaces');
    assert.equal(section.querySelectorAll('.component').length, 0);
  } finally { ui.dom.window.close(); }
});
test('modules without INTERFACE retain ordinary interface components without an empty section', () => {
  const ui = setup();
  try {
    ui.send(parse('REGISTER(count,uint32_t); QUERY(value,uint32_t) { return count; }'));
    assert.equal(ui.document.querySelector('#components h3').textContent, 'Interfaces');
    ui.document.querySelector('.component').click();
    assert.match(ui.document.querySelector('#details').textContent, /return count/);
    ui.send(parse('REGISTER(count,uint32_t);'), { version: 2, currentVersion: 2 });
    assert.ok(![...ui.document.querySelectorAll('#components h3')].some(heading => heading.textContent === 'Interfaces'));
  } finally { ui.dom.window.close(); }
});
test('stale snapshots are labeled, older versions ignored and deleted selection cleared', () => {
  const ui = setup();
  try {
    ui.send(parse('REGISTER(old,int);')); ui.document.querySelector('.component').click();
    ui.send(parse('REGISTER(old,int);'), { stale: true, currentVersion: 2 });
    assert.match(ui.document.querySelector('#status').textContent,/Out of date/);
    ui.send(parse('REGISTER(ghost,int);'), { currentVersion: 1 });
    assert.doesNotMatch(ui.document.querySelector('#components').textContent,/ghost/);
    ui.send(parse(''), { version: 2, currentVersion: 2, dirty: true });
    assert.match(ui.document.querySelector('#details').textContent,/Select a component/);
    assert.match(ui.document.querySelector('#status').textContent,/Unsaved/);
  } finally { ui.dom.window.close(); }
});
test('declaration errors remain visible alongside recoverable components', () => {
  const ui = setup();
  try {
    ui.send(parse('REGISTER(broken); REGISTER(good,int);'));
    assert.match(ui.document.querySelector('#issues').textContent,/missing required/);
    assert.match(ui.document.querySelector('#components').textContent,/good/);
  } finally { ui.dom.window.close(); }
});
test('extension metadata binds only the requested extensions and namespaces', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.name,'vul-tools'); assert.equal(pkg.displayName,'VUL Tools');
  assert.equal(pkg.publisher,'mengcz-sdu'); assert.equal(pkg.version,'0.1.0');
  assert.deepEqual(pkg.contributes.languages.flatMap(l => l.extensions),['.vul','.utb']);
  assert.ok(pkg.contributes.commands.every(c => c.command.startsWith('vul-tools.') && c.title.startsWith('VUL Tools:')));
  assert.ok(Object.keys(pkg.contributes.configuration.properties).every(k => k.startsWith('vulTools.')));
  assert.equal(pkg.contributes.customEditors[0].priority,'option');
});
