'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { Sidebar, calculateLayout, migrateState, HEADER, DIVIDER, MIN_CONTENT } = require('../media/sidebar');
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
function setup(state, height = 600) {
  const dom = new JSDOM('<nav></nav>');
  const nav = dom.window.document.querySelector('nav');
  let viewportHeight = height;
  nav.getBoundingClientRect = () => ({ height: viewportHeight });
  let changes = 0;
  const sidebar = new Sidebar(nav, { state, onChange: () => changes++ });
  const descriptor = (id, defaultOpen = true, extra = {}) => ({ id, title: id, defaultOpen, render: body => { body.textContent = id + ' contents'; }, ...extra });
  const toggle = (index, open) => {
    sidebar.items[index].node.open = open;
    sidebar.items[index].node.dispatchEvent(new dom.window.Event('toggle'));
  };
  const key = (divider, value) => divider.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  return { dom, nav, sidebar, descriptor, toggle, key, setHeight: value => { viewportHeight = value; sidebar.resize(); }, changes: () => changes };
}
test('all combinations preserve source order and place one divider after each preceding expanded pane', () => {
  for (let count = 1; count <= 7; count++) for (let mask = 0; mask < 2 ** count; mask++) {
    const sections = Array.from({ length: count }, (_, i) => ({ id: String(i), open: !!(mask & (1 << i)) }));
    const open = sections.filter(section => section.open);
    const result = calculateLayout(sections, 800);
    assert.equal(result.dividers.length, Math.max(0, open.length - 1));
    result.dividers.forEach((edge, i) => {
      assert.equal(edge.upper, open[i].id); assert.equal(edge.lower, open[i + 1].id);
      assert.equal(edge.after, Number(open[i].id));
    });
    sections.forEach((section, i) => {
      if (!section.open) assert.equal(result.heights[i], HEADER);
      else assert.ok(result.heights[i] >= HEADER + MIN_CONTENT);
    });
    close(result.heights.reduce((a, b) => a + b, 0) + DIVIDER * result.dividers.length, result.totalHeight);
    if (open.length) close(result.totalHeight, 800);
  }
});
test('default content shares reserve 30% for globals and divide the rest among any number of panes', () => {
  const sections = [{ id:'interface', open:true }, { id:'globals', open:true, defaultShare:0.3 }, { id:'local', open:true }, { id:'fast', open:true }];
  const result = calculateLayout(sections, 1000);
  const total = Object.values(result.content).reduce((a,b)=>a+b,0);
  close(result.content.globals, total * 0.3);
  for (const id of ['interface','local','fast']) close(result.content[id], total * 0.7 / 3);
  sections[1].open = false;
  const hidden = calculateLayout(sections, 1000);
  close(hidden.content.interface, hidden.content.fast);
});
test('short windows retain every heading and minimum content height by overflowing rather than hiding panes', () => {
  const result = calculateLayout(Array.from({length:8},(_,i)=>({id:String(i),open:true})),120);
  assert.ok(result.totalHeight > 120);
  assert.ok(Object.values(result.content).every(value=>value===MIN_CONTENT));
});
test('legacy expansion and custom two-pane proportions migrate without offsets or loss of explicit collapse', () => {
  const state = migrateState({}, {globals:false,module:true,'file:old':false},0.4);
  assert.deepEqual(state.expanded,{globals:false,module:true});
  close(state.weights.globals,0.4); close(state.weights.module,0.6);
  const saved = migrateState({expanded:{module:false,'version:x':true},weights:{module:0.2}},state.expanded,0.4);
  assert.equal(saved.expanded.module,false); assert.equal(saved.expanded['version:x'],true);
  close(saved.weights.module,0.2);
});
test('open-closed-closed-open renders its separator above the closed run; a single open pane fills remaining space', () => {
  const ui = setup();
  try {
    ui.sidebar.setSections([ui.descriptor('a'),ui.descriptor('b',false),ui.descriptor('c',false),ui.descriptor('d')]);
    assert.deepEqual([...ui.nav.children].map(node=>node.dataset.section || 'divider'),['a','divider','b','c','d']);
    ui.toggle(3,false);
    assert.equal(ui.nav.querySelectorAll('[role=separator]').length,0);
    close(ui.sidebar.layout.heights[0],600 - 3 * HEADER);
    ui.toggle(0,false);
    assert.ok(ui.sidebar.layout.heights.every(height=>height===HEADER));
    assert.deepEqual([...ui.nav.children].map(node=>node.dataset.section),['a','b','c','d']);
  } finally { ui.sidebar.dispose(); ui.dom.window.close(); }
});
test('keyboard resizing affects only neighboring expanded panes, persists across collapse and refresh, and double-click resets the pair', () => {
  const ui = setup();
  try {
    const descriptors=[ui.descriptor('a'),ui.descriptor('b'),ui.descriptor('c')];
    ui.sidebar.setSections(descriptors);
    const before={...ui.sidebar.layout.content};
    const divider=ui.nav.querySelector('[role=separator]');
    ui.key(divider,'ArrowDown');
    assert.ok(ui.sidebar.layout.content.a > before.a); close(ui.sidebar.layout.content.c,before.c);
    const ratio=ui.sidebar.layout.content.a/ui.sidebar.layout.content.b;
    const saved=ui.sidebar.serializeState();
    ui.toggle(1,false);ui.toggle(1,true);
    close(ui.sidebar.layout.content.a/ui.sidebar.layout.content.b,ratio);
    ui.sidebar.setSections(descriptors);
    close(ui.sidebar.layout.content.a/ui.sidebar.layout.content.b,ratio);
    assert.deepEqual(ui.sidebar.serializeState().weights,saved.weights);
    const reset=ui.nav.querySelector('[role=separator]');reset.dispatchEvent(new ui.dom.window.Event('dblclick'));
    close(ui.sidebar.layout.content.a,ui.sidebar.layout.content.b);
    ui.key(reset,'Home'); close(ui.sidebar.layout.content.a,MIN_CONTENT);
    ui.key(reset,'End'); close(ui.sidebar.layout.content.b,MIN_CONTENT);
    assert.ok(ui.changes()>0);
  } finally { ui.sidebar.dispose(); ui.dom.window.close(); }
});
test('pointer capture survives resize, honors minima, cancels on fold, and disposes all live drag state', () => {
  const ui=setup();
  try {
    ui.sidebar.setSections([ui.descriptor('a'),ui.descriptor('b',false),ui.descriptor('c')]);
    const divider=ui.nav.querySelector('[role=separator]');let captured;
    divider.setPointerCapture=id=>{captured=id;};divider.hasPointerCapture=id=>captured===id;divider.releasePointerCapture=()=>{captured=undefined;};
    const pointer=(type,y)=>{const event=new ui.dom.window.Event(type,{cancelable:true});Object.assign(event,{pointerId:7,clientY:y,button:0,isPrimary:true});divider.dispatchEvent(event);};
    const before=ui.sidebar.layout.content.a;
    pointer('pointerdown',100);pointer('pointermove',145);
    close(ui.sidebar.layout.content.a,before+45);
    assert.equal(ui.nav.querySelector('[role=separator]'),divider);
    assert.equal(captured,7);
    pointer('pointermove',9999);close(ui.sidebar.layout.content.c,MIN_CONTENT);
    ui.toggle(2,false);assert.equal(captured,undefined);
    assert.equal(ui.dom.window.document.body.classList.contains('resizing-sidebar'),false);
    ui.sidebar.dispose();assert.equal(ui.nav.children.length,0);
  } finally { ui.sidebar.dispose();ui.dom.window.close(); }
});

test('each content viewport receives its exact layout height after resize, fold and keyboard adjustment', () => {
  const ui=setup();
  try {
    ui.sidebar.setSections([ui.descriptor('a'),ui.descriptor('b'),ui.descriptor('c',false)]);
    const check=()=>{for(const item of ui.sidebar.items)close(parseFloat(item.body.style.height),ui.sidebar.layout.content[item.id]);};
    check();assert.equal(ui.sidebar.items[2].body.style.height,'0px');
    ui.key(ui.nav.querySelector('[role=separator]'),'ArrowDown');check();
    ui.setHeight(900);check();
    ui.toggle(1,false);check();assert.equal(ui.sidebar.items[1].body.style.height,'0px');
    ui.toggle(2,true);check();
    ui.sidebar.items[0].body.scrollTop=50;
    ui.sidebar.items[2].body.scrollTop=10;
    assert.equal(ui.sidebar.items[0].body.scrollTop,50);assert.equal(ui.sidebar.items[2].body.scrollTop,10);
    ui.sidebar.resize();check();assert.equal(ui.sidebar.items[0].body.scrollTop,50);
  } finally {ui.sidebar.dispose();ui.dom.window.close();}
});
test('natural INTERFACE measurement restores an explicit viewport and the 35% initial cap never limits manual sizes', () => {
  const ui=setup();
  try {
    ui.sidebar.setSections([ui.descriptor('interface',true,{initialFit:{maxShare:0.35}}),ui.descriptor('module')]);
    const body=ui.sidebar.items[0].body;
    Object.defineProperty(body,'scrollHeight',{get:()=>120});
    ui.sidebar.resize();
    close(ui.sidebar.layout.heights[0],HEADER+120);assert.equal(body.style.height,'120px');
    ui.setHeight(300);close(ui.sidebar.layout.heights[0],105);assert.equal(body.style.height,'69px');
    ui.key(ui.nav.querySelector('[role=separator]'),'End');
    assert.ok(ui.sidebar.layout.heights[0]>300*0.35);
    const weights=ui.sidebar.serializeState().weights;
    ui.sidebar.resize();assert.deepEqual(ui.sidebar.serializeState().weights,weights);
    close(parseFloat(body.style.height),ui.sidebar.layout.content.interface);
  } finally {ui.sidebar.dispose();ui.dom.window.close();}
});
test('content fitting remains inactive for historical sizes and closed contents have no viewport height', () => {
  const ui=setup({weights:{interface:0.8,module:0.2}});
  try {
    ui.sidebar.setSections([ui.descriptor('interface',true,{initialFit:{maxShare:0.35}}),ui.descriptor('module')]);
    const body=ui.sidebar.items[0].body;
    Object.defineProperty(body,'scrollHeight',{get:()=>30});
    ui.sidebar.resize();assert.ok(ui.sidebar.layout.heights[0]>600*0.35);
    ui.toggle(0,false);assert.equal(body.style.height,'0px');
    ui.toggle(0,true);assert.ok(parseFloat(body.style.height)>600*0.35);
  } finally {ui.sidebar.dispose();ui.dom.window.close();}
});
