'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { posix } = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { parse } = require('../out/parser');
// Exercise the host service against a URI-aware filesystem, including remote authorities.
function host() {
  class Uri {
    constructor(value) { this.url = new URL(value); this.path = decodeURIComponent(this.url.pathname); }
    static parse(value) { return new Uri(value); }
    static joinPath(base, path) { return base.with({path:posix.join(base.path,path)}); }
    with({path}) { const next = new URL(this.url); next.pathname = path; return new Uri(next.href); }
    toString() { return this.url.href; }
  }
  class FileSystemError extends Error { constructor() { super('not found'); this.code='FileNotFound'; } }
  const files = new Map(), docs = [], watchers = [], diagnostics = new Map();
  const config = { root:'' }; let gate;
  const source = uri => {
    const doc=docs.find(d=>d.uri.toString()===uri.toString());
    if(doc) return doc;
    if(!files.has(uri.path)) throw new FileSystemError();
    return document(uri.path, files.get(uri.path));
  };
  function document(path, text) {
    const doc={uri:Uri.parse('vscode-remote://ssh-remote+test'+path), version:1,isDirty:false,isClosed:false,getText:()=>text,positionAt:offset=>({line:0,character:offset}),change(value){text=value;this.version++;this.isDirty=true;}};
    docs.push(doc);return doc;
  }
  const vscode={Uri,FileSystemError,FileType:{File:1,Directory:2,SymbolicLink:64},
    RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern;}},
    Position:class{constructor(line,character){this.line=line;this.character=character;}},Diagnostic:class{},Range:class{},DiagnosticSeverity:{Error:0,Warning:1},
    languages:{createDiagnosticCollection:()=>({clear:()=>diagnostics.clear(),set:(uri,issues)=>diagnostics.set(uri.toString(),issues),dispose:()=>diagnostics.clear()})},
    workspace:{textDocuments:docs,getConfiguration:()=>({get:(name,fallback)=>name==='projectRoot'?config.root:fallback}),
      getWorkspaceFolder:()=>({uri:Uri.parse('vscode-remote://ssh-remote+test/ws')}),
      openTextDocument:async uri=>source(uri),
      createFileSystemWatcher(pattern){const w={pattern,disposed:false,onDidCreate(fn){this.create=fn;},onDidChange(fn){this.change=fn;},onDidDelete(fn){this.delete=fn;},dispose(){this.disposed=true;}};watchers.push(w);return w;},
      fs:{async stat(uri){if(files.has(uri.path))return{type:1};if([...files.keys()].some(p=>p.startsWith(uri.path.replace(/\/$/,'')+'/')))return{type:2};throw new FileSystemError();},
        async readDirectory(uri){const prefix=uri.path+'/';const names=new Map();for(const file of files.keys())if(file.startsWith(prefix)){const rel=file.slice(prefix.length),name=rel.split('/')[0];names.set(name,rel.includes('/')?2:1);}return [...names];},
        async readFile(uri){const text=files.get(uri.path);if(text===undefined)throw new FileSystemError();if(gate)await gate(uri);return Buffer.from(text);}}
    }};
  const file=require.resolve('../out/projects');const localRequire=createRequire(file);const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:name=>name==='vscode'?vscode:localRequire(name),Buffer,setTimeout,clearTimeout});
  const service=new module.exports.ProjectService(()=>{});
  return { service,files,docs,document,watchers,config,diagnostics,setGate(fn){gate=fn;} };
}
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
test('remote project cache is shared, dirty Headers invalidate all modules, and watchers release', async () => {
  const h=host();h.files.set('/ws/header.uh','CONFIG(WIDTH,32);');
  const first=h.document('/ws/First.vul',''),second=h.document('/ws/Second.vul','');
  try {
    await Promise.all([h.service.refresh(first,[]),h.service.refresh(second,[])]);
    assert.equal(h.service.get(first.uri),h.service.get(second.uri));
    assert.equal(h.service.get(first.uri).root,'vscode-remote://ssh-remote+test/ws');
    const header=h.document('/ws/header.uh','CONFIG(WIDTH,32);');
    header.change('CONFIG(WIDTH,64);');h.service.headerChanged(header,false);
    assert.equal(h.service.get(second.uri).stale,true);
    await h.service.refresh(first,[]);
    assert.equal(h.service.get(second.uri).files[0].result.components[0].attributes[1].value,'64');
    assert.equal(h.service.get(second.uri).files[0].dirty,true);
    h.service.remove(first.uri);assert.ok(h.watchers.some(w=>!w.disposed));
    h.service.remove(second.uri);assert.ok(h.watchers.every(w=>w.disposed));
  } finally {h.service.dispose();}
});
test('a delayed previous root cannot replace a newer module PROJECT binding', async () => {
  const h=host();h.files.set('/old/header.uh','CONFIG(OLD,1);');h.files.set('/new/header.uh','CONFIG(NEW,1);');
  const doc=h.document('/ws/Top.vul','PROJECT("/old");');let unblock,started;
  const began=new Promise(resolve=>{started=resolve;});const waiting=new Promise(resolve=>{unblock=resolve;});
  h.setGate(async uri=>{if(uri.path==='/old/header.uh'){started();await waiting;}});
  try {
    const old=h.service.refresh(doc,parse(doc.getText()).components);await began;
    doc.change('PROJECT("/new");');h.service.invalidateBinding(doc.uri);
    await h.service.refresh(doc,parse(doc.getText()).components);
    unblock();await old;
    assert.equal(h.service.get(doc.uri).root,'vscode-remote://ssh-remote+test/new');
    assert.equal(h.service.get(doc.uri).files[0].result.components[0].name,'NEW');
  } finally {unblock();h.service.dispose();}
});
test('an edit during asynchronous loading leaves the result stale until refreshed', async () => {
  const h=host();h.files.set('/ws/header.uh','CONFIG(OLD,1);');const doc=h.document('/ws/Top.vul','');
  let unblock,started;const began=new Promise(resolve=>{started=resolve;});const waiting=new Promise(resolve=>{unblock=resolve;});
  h.setGate(async()=>{started();await waiting;});
  try {
    const pending=h.service.refresh(doc,[]);await began;
    const header=h.document('/ws/header.uh','CONFIG(NEW,2);');header.isDirty=true;
    h.service.headerChanged(header,false);unblock();await pending;
    assert.equal(h.service.get(doc.uri).stale,true);
    await h.service.refresh(doc,[]);
    assert.equal(h.service.get(doc.uri).stale,false);
    assert.equal(h.service.get(doc.uri).files[0].result.components[0].name,'NEW');
  } finally {unblock();h.service.dispose();}
});
test('filesystem notifications reload file sets and removed projects clear diagnostics', async () => {
  const h=host();h.files.set('/ws/header/a.uh','ALIAS(Bad);');const doc=h.document('/ws/Top.vul','');
  try {
    await h.service.refresh(doc,[]);await delay(0);
    assert.ok([...h.diagnostics.values()].some(issues=>issues.length));
    h.files.set('/ws/header/b.uh','CONFIG(B,2);');
    h.watchers.find(w=>!w.disposed&&w.pattern.base.path==='/ws').create();
    assert.equal(h.service.get(doc.uri).stale,true);
    await delay(220);
    assert.equal(h.service.get(doc.uri).files.length,2);
    h.service.remove(doc.uri);await delay(0);
    assert.equal(h.diagnostics.size,0);
  } finally {h.service.dispose();}
});

test('ordinary module edits keep shared Headers current; deleting the nearest project discovers its ancestor', async () => {
  const h=host();h.files.set('/ws/header.uh','CONFIG(OUTER,1);');h.files.set('/ws/inner/header.uh','CONFIG(INNER,1);');
  const doc=h.document('/ws/inner/Top.vul','REGISTER(r,int);');
  try {
    await h.service.refresh(doc,parse(doc.getText()).components);
    doc.change('REGISTER(other,int);');h.service.invalidateBinding(doc.uri);
    h.service.rebindIfChanged(doc,parse(doc.getText()).components);
    assert.equal(h.service.get(doc.uri).stale,false);
    h.files.delete('/ws/inner/header.uh');
    h.watchers.find(w=>!w.disposed&&w.pattern.base.path==='/ws/inner').delete();
    await delay(220);
    assert.equal(h.service.get(doc.uri).root,'vscode-remote://ssh-remote+test/ws');
    assert.equal(h.service.get(doc.uri).files[0].result.components[0].name,'OUTER');
  } finally {h.service.dispose();}
});
