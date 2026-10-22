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
test('webview selection displays defaults and an editable local code buffer', () => {
  const ui = setup();
  try {
    const body = '{ auto html="<img src=x onerror=alert(1)>"; }';
    ui.send(parse(`REGISTER(counter, uint32_t) ${body}`));
    ui.document.querySelector('.component').click();
    assert.match(ui.document.querySelector('#details').textContent,/Default \/ inferred/);
    assert.equal(ui.document.querySelector('#details .code-editor').value, 'auto html="<img src=x onerror=alert(1)>";');
    assert.equal(ui.document.querySelectorAll('img,input,[contenteditable]').length, 0);
    assert.deepEqual(ui.messages.filter(m => m.type !== 'highlight').map(m => m.type), ['ready']);
    ui.document.querySelector('#refresh').click(); ui.document.querySelector('#source').click();
    assert.deepEqual(ui.messages.filter(m => m.type !== 'highlight').map(m => m.type), ['ready','refresh','source']);
  } finally { ui.dom.window.close(); }
});
test('interface selection shows linked implementations with version ownership', () => {
  const ui = setup();
  try {
    ui.send(parse('INTERFACE() { QUERY(value,uint32_t); } USE_VERSION(fast); VERSION(fast) { QUERY(value,uint32_t) { return 2; } }'));
    const query = [...ui.document.querySelectorAll('.component')].find(b => b.textContent.startsWith('QUERY'));
    query.click();
    assert.match(ui.document.querySelector('#details .code-editor').value,/return 2/);
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
    const sections = ui.document.querySelector('.module-section > .declarations').children;
    assert.equal(sections[0].querySelector('h3').textContent, 'Interfaces');
    assert.deepEqual([...sections[0].querySelectorAll('.component')].map(button => `${button.querySelector('.component-kind').textContent} · ${button.querySelector('.component-name').textContent}`), [
      'PARAMETER · WIDTH', 'REQUEST · out()', 'SERVICE · push()', 'QUERY · value → uint32_t'
    ]);
    assert.equal([...ui.document.querySelectorAll('#components h3')].filter(heading => heading.textContent === 'Interfaces').length, 1);
    assert.ok(![...ui.document.querySelectorAll('.component')].some(button => button.textContent.startsWith('INTERFACE')));
    sections[0].querySelectorAll('.component')[3].click();
    assert.match(ui.document.querySelector('#details .code-editor').value, /return count/);
    assert.match(ui.document.querySelector('#components').textContent, /Implementations/);
  } finally { ui.dom.window.close(); }
});
test('empty INTERFACE has one heading and no selectable block', () => {
  const ui = setup();
  try {
    ui.send(parse('INTERFACE() {} REGISTER(count,uint32_t);'));
    const section = ui.document.querySelector('.module-section > .declarations').firstElementChild;
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
    assert.match(ui.document.querySelector('#details .code-editor').value, /return count/);
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
test('list items use bold macro names and names with regular parameter summaries', () => {
  const ui = setup();
  try {
    ui.send(parse('REGISTER(counter,uint32_t,ports=2); REQUEST(out,ARG(uint32_t) data);'));
    const button = [...ui.document.querySelectorAll('.component')].find(button => button.querySelector('.component-name')?.textContent === 'counter<uint32_t>');
    assert.equal(button.querySelector('.component-kind').tagName, 'STRONG');
    assert.equal(button.querySelector('.component-name').tagName, 'STRONG');
    assert.equal(button.querySelector('.component-type').textContent, '<uint32_t>');
    assert.doesNotMatch(button.querySelector('.component-summary').textContent, /type=|dims=/);
    assert.match(button.querySelector('.component-summary').textContent, /ports=2/);
    assert.doesNotMatch(button.querySelector('.component-summary').textContent, /name=counter/);
    const request = [...ui.document.querySelectorAll('.component')].find(button => button.querySelector('.component-kind').textContent === 'REQUEST');
    assert.equal(request.querySelector('.component-name').textContent, 'out(uint32_t data)');
    assert.equal(request.querySelector('.component-summary'), null);
    button.click();
    const cells = ui.document.querySelectorAll('#details tbody tr td:first-child');
    assert.ok(cells.length);
    assert.ok([...cells].every(cell => cell.firstElementChild?.tagName === 'STRONG'));
  } finally { ui.dom.window.close(); }
});
test('named tick blocks remain individually selectable with their original code', () => {
  const ui = setup();
  try {
    ui.send(parse('TICK_IMPL(update_count) { count.setnext(1); } TICK_IMPL(name=report) { output(count); } TICK_IMPL() {}'));
    const buttons = [...ui.document.querySelectorAll('.component')];
    assert.deepEqual(buttons.map(button => button.querySelector('.component-name')?.textContent), ['update_count', 'report', undefined]);
    buttons[1].click();
    assert.equal(ui.document.querySelector('#details .code-editor').value, 'output(count);');
  } finally { ui.dom.window.close(); }
});
test('submodule groups include child imports and both ends of child-to-child connections', () => {
  const ui = setup();
  try {
    const result = parse(`
      USE_CHILD_SERVICE(src,send,send_alias,ARG(uint32_t) data);
      CHILD_INSTANCE(Node,src,PARAM(WIDTH)=32);
      CHILD_INSTANCE(Node,dst);
      USE_CHILD_QUERY(dst,value,value_alias,uint32_t);
      CONNECT_CR_CS(dstchild=dst,dstserv=recv,srcchild=src,srcreq=send);
      CONNECT_CR_R(src,send,output);
      CONNECT_CR_S(src,send,local_service);
      CONNECT_S_CS(input,dst,recv);
    `);
    assert.deepEqual(result.issues, []);
    ui.send(result);
    const groups = [...ui.document.querySelectorAll('.submodule')];
    assert.deepEqual(groups.map(group => group.dataset.instance), ['src', 'dst']);
    assert.ok(groups.every(group => group.parentElement.querySelector('h3').textContent === 'Submodules and Connections'));
    assert.match(groups[0].querySelector('h4 .component-summary').textContent, /PARAM\(WIDTH\)=32/);
    const kinds = group => [...group.querySelectorAll('.component-kind')].map(node => node.textContent);
    assert.deepEqual(kinds(groups[0]), ['CHILD_INSTANCE', 'USE_CHILD_SERVICE', 'CONNECT_CR_CS', 'CONNECT_CR_R', 'CONNECT_CR_S']);
    assert.deepEqual(kinds(groups[1]), ['CHILD_INSTANCE', 'USE_CHILD_QUERY', 'CONNECT_CR_CS', 'CONNECT_S_CS']);
    const id = result.components.find(node => node.kind === 'CONNECT_CR_CS').id;
    const copies = [...ui.document.querySelectorAll('.component')].filter(button => button.dataset.id === JSON.stringify(['file:///Top.vul', id]));
    assert.equal(copies.length, 2);
    copies[1].click();
    assert.ok(copies.every(button => button.getAttribute('aria-pressed') === 'true'));
    assert.match(ui.document.querySelector('#details h2').textContent, /src.send → dst.recv/);
  } finally { ui.dom.window.close(); }
});
test('array endpoints share their declaration group and self-connections appear once', () => {
  const ui = setup();
  try {
    ui.send(parse('CHILD_INSTANCE(Node,lane,dims=[4]); USE_CHILD_QUERY(lane[*],value,values,uint32_t); CONNECT_CR_CS(lane[$],send,lane[$+1],recv);'));
    const group = ui.document.querySelector('.submodule');
    assert.equal(group.dataset.instance, 'lane');
    assert.equal(group.querySelectorAll('.component').length, 3);
    assert.match(group.textContent, /lane\[\$\].send → lane\[\$\+1\].recv/);
  } finally { ui.dom.window.close(); }
});
test('submodule grouping stays inside versions and preserves unresolved references', () => {
  const ui = setup();
  try {
    ui.send(parse('INTERFACE() {} USE_VERSION(one); VERSION(one) { CHILD_INSTANCE(Node,n); USE_CHILD_SERVICE(n,push,first); } VERSION(two) { CHILD_INSTANCE(Node,n); USE_CHILD_SERVICE(n,push,second); } USE_CHILD_QUERY(missing,value,unresolved,uint32_t);'));
    const groups = ui.document.querySelectorAll('.submodule');
    assert.equal(groups.length, 2);
    assert.match(groups[0].textContent, /first/);
    assert.doesNotMatch(groups[0].textContent, /second/);
    assert.match(groups[1].textContent, /second/);
    assert.doesNotMatch(groups[1].textContent, /first/);
    const unresolved = [...ui.document.querySelectorAll('.component')].find(button => button.querySelector('.component-name')?.textContent === 'unresolved');
    assert.ok(unresolved);
    assert.equal(unresolved.closest('.submodule'), null);
  } finally { ui.dom.window.close(); }
});
test('alias and register types combine dimensions without repeating type parameters', () => {
  const ui = setup();
  try {
    ui.send(parse('ALIAS(Word,uint32_t); ALIAS(Lane,uint32_t,dims=[8,WIDTH]); REGISTER(bank,Word,ports=2,dims=[N,clog2(max(A,B))]);'));
    const buttons = [...ui.document.querySelectorAll('.component')];
    assert.deepEqual(buttons.map(button => button.querySelector('.component-type').textContent), [
      ' → uint32_t', ' → uint32_t[8][WIDTH]', '<Word[N][clog2(max(A,B))]>'
    ]);
    assert.equal(buttons[0].querySelector('.component-summary'), null);
    assert.equal(buttons[1].querySelector('.component-summary'), null);
    assert.equal(buttons[2].querySelector('.component-summary').textContent.trim(), 'ports=2');
    buttons[1].click();
    const rows = [...ui.document.querySelectorAll('#details tbody tr')];
    assert.ok(rows.some(row => row.cells[0].textContent === 'dims' && row.cells[1].textContent === '[8,WIDTH]'));
  } finally { ui.dom.window.close(); }
});
test('code boxes remove outer braces and common indentation while preserving nested code', () => {
  const ui = setup();
  try {
    const result = parse('TICK_IMPL(work) {\r\n\t\tif (ready) {\r\n\t\t\trun();\r\n\t\t}\r\n\r\n\t\tdone();\r\n}');
    const original = result.components[0].codeBlocks[0].code;
    ui.send(result, { editorOptions: { tabSize: 4 } });
    ui.document.querySelector('.component').click();
    assert.equal(ui.document.querySelector('.code-editor').value, 'if (ready) {\n    run();\n}\n\ndone();');
    assert.equal(result.components[0].codeBlocks[0].code, original);
    ui.send(parse('TICK_IMPL() {}'), { currentVersion: 2, version: 2 });
    ui.document.querySelector('.component').click();
    assert.equal(ui.document.querySelector('.code-editor').value, '');
  } finally { ui.dom.window.close(); }
});
test('temporary edits survive selection and font changes but refresh restores source', () => {
  const ui = setup();
  try {
    const result = parse('TICK_IMPL(first) {\n    first();\n} TICK_IMPL(second) { second(); }');
    ui.send(result);
    const buttons = ui.document.querySelectorAll('.component');
    buttons[0].click();
    const editor = ui.document.querySelector('.code-editor');
    assert.equal(editor.readOnly, false);
    editor.value = 'temporary();';
    editor.dispatchEvent(new ui.dom.window.Event('input', { bubbles: true }));
    buttons[1].click(); buttons[0].click();
    assert.equal(ui.document.querySelector('.code-editor').value, 'temporary();');
    ui.dom.window.dispatchEvent(new ui.dom.window.MessageEvent('message', { data: {
      type: 'editorSettings', editorOptions: { fontFamily: 'Fira Code, monospace', fontSize: 17, fontWeight: '500', lineHeight: 26, tabSize: 2 }
    } }));
    assert.equal(ui.document.querySelector('.code-editor').value, 'temporary();');
    assert.equal(ui.document.documentElement.style.getPropertyValue('--vul-code-font-family'), 'Fira Code, monospace');
    assert.equal(ui.document.documentElement.style.getPropertyValue('--vul-code-font-size'), '17px');
    assert.equal(ui.document.documentElement.style.getPropertyValue('--vul-code-line-height'), '26px');
    assert.deepEqual(ui.messages.filter(message => message.type !== 'highlight').map(message => message.type), ['ready']);
    assert.match(result.components[0].codeBlocks[0].code, /first\(\)/);
    ui.send(result);
    assert.equal(ui.document.querySelector('.code-editor').value, 'first();');
  } finally { ui.dom.window.close(); }
});
test('parameter defaults appear beside the bold name without a duplicate value summary', () => {
  const ui = setup();
  try {
    ui.send(parse('INTERFACE() { PARAMETER(WIDTH,BASE * 2 + 1); PARAMETER(name=DEPTH,value=clog2(WIDTH)); }'));
    const buttons = ui.document.querySelectorAll('.component');
    assert.match(buttons[0].textContent, /WIDTH = BASE \* 2 \+ 1/);
    assert.match(buttons[1].textContent, /DEPTH = clog2\(WIDTH\)/);
    assert.equal(buttons[0].querySelector('.component-name').tagName, 'STRONG');
    assert.equal(buttons[0].querySelector('.component-summary'), null);
  } finally { ui.dom.window.close(); }
});
test('highlight responses color safe text, ignore stale edits and refresh on theme changes', () => {
  const ui = setup();
  try {
    ui.send(parse('TICK_IMPL() { return 1; }'));
    ui.document.querySelector('.component').click();
    const editor = ui.document.querySelector('.code-editor'), surface = editor.parentElement;
    const first = ui.messages.find(message => message.type === 'highlight');
    assert.equal(first.code, 'return 1;');
    const sendHighlight = (requestId, lines) => ui.dom.window.dispatchEvent(new ui.dom.window.MessageEvent('message', { data: { type: 'highlightResult', requestId, result: { lines } } }));
    sendHighlight(first.requestId, [[{ start:0, end:6, color:'#123456' }, { start:6, end:9, color:'#654321' }]]);
    assert.ok(surface.classList.contains('is-highlighted'));
    assert.equal(surface.querySelector('.code-highlight').textContent, 'return 1;\n');
    assert.equal(surface.querySelector('.code-highlight span').style.color, 'rgb(18, 52, 86)');
    editor.value = '<img src=x onerror=alert(1)>';
    editor.dispatchEvent(new ui.dom.window.Event('input'));
    assert.ok(!surface.classList.contains('is-highlighted'));
    sendHighlight(first.requestId, [[{ start:0, end:6, color:'#FFFFFF' }]]);
    assert.ok(!surface.classList.contains('is-highlighted'));
    ui.dom.window.dispatchEvent(new ui.dom.window.MessageEvent('message', { data:{ type:'highlightThemeChanged' } }));
    const latest = ui.messages.filter(message => message.type === 'highlight').at(-1);
    assert.equal(latest.code, editor.value);
    sendHighlight(latest.requestId, [[{ start:0, end:editor.value.length, color:'#ABCDEF' }]]);
    assert.equal(surface.querySelectorAll('img').length,0);
    assert.equal(surface.querySelector('.code-highlight').textContent, editor.value+'\n');
    editor.scrollTop = 30; editor.scrollLeft = 25;
    editor.dispatchEvent(new ui.dom.window.Event('scroll'));
    assert.equal(surface.querySelector('.code-highlight').scrollLeft,25);
    assert.equal(surface.querySelector('.code-highlight').scrollTop,30);
    assert.ok(ui.messages.every(message => ['ready','highlight'].includes(message.type)));
  } finally { ui.dom.window.close(); }
});
test('request and service signatures include response references and effective handshake', () => {
  const ui = setup();
  try {
    ui.send(parse('REQUEST(fetch,handshake=true,dims=[2],ARG(uint32_t) data,RESP(uint64_t) resp); SERVICE(recv,ready=accept,priority=3,ARG(uint32_t) data,RESP(uint64_t) resp) {} SERVICE(idle) {} REQUEST(no_ready,handshake=false);'));
    const buttons = [...ui.document.querySelectorAll('.component')];
    assert.deepEqual(buttons.map(button => button.querySelector('.component-name').textContent), [
      'fetch(uint32_t data, uint64_t & resp) -> bool',
      'recv(uint32_t data, uint64_t & resp) -> bool', 'idle()', 'no_ready()'
    ]);
    assert.equal(buttons[0].querySelector('.component-summary').textContent.trim(), 'dims=[2]');
    assert.equal(buttons[1].querySelector('.component-summary').textContent.trim(), 'ready=accept, priority=3');
    assert.equal(buttons[2].querySelector('.component-summary'), null);
    assert.equal(buttons[3].querySelector('.component-summary'), null);
    assert.ok(buttons.every(button => button.querySelector('.component-name').tagName === 'STRONG'));
  } finally { ui.dom.window.close(); }
});
test('only explicit list parameters are shown while details retain defaults', () => {
  const ui = setup();
  try {
    ui.send(parse('QUEUE(q,uint32_t,8); REGISTER(r,uint64_t,ports=1); CHILD_INSTANCE(Node,child); USE_CHILD_QUERY(child,value,read_value,uint32_t);'));
    const buttons = [...ui.document.querySelectorAll('.component')];
    const find = kind => buttons.find(button => button.querySelector('.component-kind').textContent === kind);
    assert.equal(find('QUEUE').querySelector('.component-summary').textContent.trim(), 'depth=8');
    assert.equal(find('REGISTER').querySelector('.component-summary').textContent.trim(), 'ports=1');
    assert.equal(find('CHILD_INSTANCE').querySelector('.component-summary').textContent.trim(), 'module=Node');
    assert.doesNotMatch(ui.document.querySelector('#components').textContent, /inferred|dims=\[\]|enq_width|deq_width/);
    find('QUEUE').click();
    assert.match(ui.document.querySelector('#details').textContent, /enq_width/);
    assert.match(ui.document.querySelector('#details').textContent, /Default \/ inferred/);
  } finally { ui.dom.window.close(); }
});
test('element types, query results and alias targets are part of the bold label', () => {
  const ui = setup();
  try {
    ui.send(parse('ALIAS(Lane,uint32_t,dims=[8,WIDTH]); REGISTER(bank,uint32_t,dims=[4]); QUEUE(fifo,Word,8); BRAM(ram,Word,1024); WIRE(temp,Word) {} QUERY(value,Word) { return temp; }'));
    const names = [...ui.document.querySelectorAll('.component-name')];
    assert.deepEqual(names.map(node => node.textContent), [
      'value → Word', 'Lane → uint32_t[8][WIDTH]', 'bank<uint32_t[4]>', 'fifo<Word>', 'ram<Word>', 'temp<Word>'
    ]);
    assert.ok(names.every(node => node.tagName === 'STRONG'));
    assert.ok([...ui.document.querySelectorAll('.component-type')].every(node => node.closest('strong.component-name')));
    assert.doesNotMatch(ui.document.querySelector('#components').textContent, /type=|dims=\[4\]/);
  } finally { ui.dom.window.close(); }
});
test('global and module sections expand independently and Header identity scopes details and drafts', async () => {
  const ui = setup();
  try {
    const module = parse('STRUCT(Same) { int module; };');
    const project = { root:'file:///p', mode:'directory', stale:false, revision:1, messages:[], files:[
      { uri:'file:///p/header/a/types.hpp', filename:'a/types.hpp', result:parse('STRUCT(Same) { int first; };', 'header') },
      { uri:'file:///p/header/b/types.hpp', filename:'b/types.hpp', result:parse('STRUCT(Same) { int second; };', 'header') }
    ] };
    ui.send(module, { project, refreshId: 1 });
    const sections = ui.document.querySelectorAll('#components > details');
    assert.deepEqual([...sections].map(s => s.firstElementChild.textContent), ['Global Declarations','Module Contents']);
    assert.ok([...sections].every(s => s.open));
    sections[0].open = false;
    sections[0].dispatchEvent(new ui.dom.window.Event('toggle'));
    assert.equal(sections[1].open,true);
    const buttons = [...ui.document.querySelectorAll('.component')];
    assert.equal(new Set(buttons.map(b => b.dataset.id)).size,3);
    buttons[0].click();
    assert.match(ui.document.querySelector('#details').textContent, /Source: a\/types.hpp/);
    let editor = ui.document.querySelector('.code-editor');
    editor.value='temporary first'; editor.dispatchEvent(new ui.dom.window.Event('input'));
    buttons[1].click(); assert.equal(ui.document.querySelector('.code-editor').value,'int second;');
    buttons[0].click(); assert.equal(ui.document.querySelector('.code-editor').value,'temporary first');
    ui.send(module, { project:{...project, stale:true, revision:2}, refreshId:1 });
    assert.equal(ui.document.querySelector('.global-section').open,false);
    assert.equal(ui.document.querySelector('.code-editor').value,'temporary first');
    assert.match(ui.document.querySelector('.global-section').textContent,/out of date/);
    ui.send(module, { project:{...project, revision:3, files:project.files.slice(1)}, refreshId:1 });
    assert.match(ui.document.querySelector('#details').textContent,/Select a component/);
    assert.ok(ui.messages.some(m => m.type === 'highlight' && m.uri === project.files[0].uri));
  } finally { ui.dom.window.close(); }
});
test('single Header has no filename group and refreshing globals preserves module drafts', () => {
  const ui = setup();
  try {
    const module = parse('TICK_IMPL() { work(); }');
    const project = { root:'file:///p', mode:'file', stale:false, revision:1, messages:[], files:[
      { uri:'file:///p/header.h', filename:'header.h', dirty:true, result:parse('CONFIG(WIDTH,32);', 'header') }
    ] };
    ui.send(module,{project,refreshId:1});
    assert.equal(ui.document.querySelectorAll('.header-section').length,0);
    assert.match(ui.document.querySelector('.global-section').textContent,/WIDTH = 32/);
    assert.match(ui.document.querySelector('.global-section').textContent,/Unsaved Header/);
    ui.document.querySelector('.module-section .component').click();
    const editor = ui.document.querySelector('.code-editor');
    editor.value = 'local();'; editor.dispatchEvent(new ui.dom.window.Event('input'));
    ui.send(module,{project:{...project,revision:2},refreshId:1});
    assert.equal(ui.document.querySelector('.code-editor').value,'local();');
    ui.send(module,{project:{...project,revision:3,messages:['Cannot read header.h'],files:[]},refreshId:1});
    assert.match(ui.document.querySelector('.global-section').textContent,/Cannot read/);
    assert.equal(ui.document.querySelector('.code-editor').value,'local();');
  } finally { ui.dom.window.close(); }
});
