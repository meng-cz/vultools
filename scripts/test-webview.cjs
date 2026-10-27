'use strict';
// Real Chromium input against the actual VS Code Webview. No test hooks are
// installed in the extension or in the product's message protocol.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function writeJson(directory, name, value) {
  await fs.writeFile(path.join(directory, name+'.tmp'), JSON.stringify(value));
  await fs.rename(path.join(directory, name+'.tmp'), path.join(directory, name));
}
async function until(check, message, attempts = 200) {
  for (let i = 0; i < attempts; i++) { const value = await check(); if (value) return value; await wait(100); }
  throw Error(message);
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.contexts = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Error(message.error.message)); else pending.resolve(message.result);
      } else if (message.method === 'Runtime.executionContextCreated') {
        const id = message.params.context.id;
        this.contexts.set(`${message.sessionId}:${id}`, { sessionId: message.sessionId, contextId: id });
      } else if (message.method === 'Runtime.executionContextsCleared') {
        for (const [key, value] of this.contexts) if (value.sessionId === message.sessionId) this.contexts.delete(key);
      } else if (message.method === 'Runtime.executionContextDestroyed') this.contexts.delete(`${message.sessionId}:${message.params.executionContextId}`);
    });
    socket.addEventListener('close', () => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('DevTools connection closed.')); } this.pending.clear(); });
  }
  static async connect(url) {
    if (typeof WebSocket !== 'function') throw Error('test:webview requires Node.js 22 or later.');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
    return new CDP(socket);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`DevTools timed out: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
    });
  }
  async evaluate(context, expression) {
    const result = await this.send('Runtime.evaluate', { expression, contextId: context.contextId, returnByValue:true, awaitPromise:true }, context.sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}
async function verify(cdp, context, directory) {
  const evaluate = expression => cdp.evaluate(context, expression);
  // Open all panes using their actual disclosure controls.
  await evaluate(`for (const pane of document.querySelectorAll('#components > details')) if (!pane.open) pane.querySelector('summary').click()`);
  await wait(200);
  const metrics = () => evaluate(`(() => {
    const nav=document.querySelector('#components');
    return {height:nav.clientHeight,outer:nav.scrollTop,right:document.querySelector('#details').scrollTop,panes:[...nav.querySelectorAll(':scope > details')].map(p=>{
      const b=p.querySelector(':scope > .declarations'),r=b.getBoundingClientRect(),h=p.querySelector('summary').getBoundingClientRect();
      return {id:p.dataset.section,open:p.open,top:b.scrollTop,client:b.clientHeight,scroll:b.scrollHeight,
        x:r.x,y:r.y,width:r.width,height:r.height,headingTop:h.top,headingHeight:h.height,
        clientWidth:b.clientWidth,offsetWidth:b.offsetWidth,barWidth:getComputedStyle(b,'::-webkit-scrollbar').width,thumb:getComputedStyle(b,'::-webkit-scrollbar-thumb').minHeight,
        overflow:getComputedStyle(b).overflowY,boundary:getComputedStyle(b).overscrollBehaviorY,gutter:getComputedStyle(b).scrollbarGutter};
    })}; })()`);
  let state=await metrics();
  assert.equal(state.panes.length,5);
  const initialInterface=state.panes.find(p=>p.id==='interface');
  assert.ok(initialInterface.height+initialInterface.headingHeight<=state.height*0.35+1,'initial INTERFACE cap must survive explicit content sizing');
  for (const pane of state.panes) {
    assert.equal(pane.overflow,'auto');assert.equal(pane.boundary,'contain');assert.equal(pane.gutter,'stable');
    assert.ok(pane.client>0);
  }
  for (const pane of state.panes.filter(p=>p.id!=='module')) assert.ok(pane.scroll>pane.client,`${pane.id} should overflow`);
  const version=state.panes.find(p=>p.id.startsWith('version:'));
  const wheel=async(delta,x=version.x+version.width/2,y=version.y+version.height/2)=>{
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:delta},context.sessionId);await wait(250);
  };
  await wheel(140);
  state=await metrics();
  assert.ok(state.panes.find(p=>p.id===version.id).top>0,'native wheel must scroll the hovered VERSION: '+JSON.stringify(state));
  for(const pane of state.panes.filter(p=>p.id!==version.id))assert.equal(pane.top,0,'another pane scrolled');
  assert.equal(state.panes.find(p=>p.id===version.id).headingTop,version.headingTop,'heading must stay fixed');
  assert.equal(state.outer,0);assert.equal(state.right,0);
  // Hit the native scrollbar thumb and drag it rather than setting scrollTop.
  await wheel(-100000);state=await metrics();
  const current=state.panes.find(p=>p.id===version.id);
  const thumbHeight=Math.max(20,current.client*current.client/current.scroll);
  const thumbY=current.y+(current.top/(current.scroll-current.client))*(current.client-thumbHeight)+thumbHeight/2;
  const x=current.x+current.width-5;
  if(process.env.VUL_WEBVIEW_SCREENSHOT){
    const target=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.type==='page'&&target.url.includes('workbench'));
    if(target){const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile(process.env.VUL_WEBVIEW_SCREENSHOT,Buffer.from(shot.data,'base64'));}
  }
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:thumbY},context.sessionId);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y:thumbY,button:'left',clickCount:1},context.sessionId);
  await wait(100);
  for(let step=1;step<=5;step++){
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:Math.min(current.y+current.client-2,thumbY+step*8),button:'left',buttons:1},context.sessionId);
    await wait(40);
  }
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:Math.min(current.y+current.client-2,thumbY+40),button:'left',clickCount:1},context.sessionId);
  await wait(200);
  state=await metrics();assert.ok(state.panes.find(p=>p.id===version.id).top>current.top,'native scrollbar drag must move the list: '+JSON.stringify({current,after:state}));
  await wheel(100000);const boundary=await metrics();await wheel(500);state=await metrics();
  assert.equal(state.panes.find(p=>p.id===version.id).top,boundary.panes.find(p=>p.id===version.id).top);
  assert.equal(state.outer,boundary.outer);assert.equal(state.right,boundary.right);
  for(const pane of state.panes.filter(p=>p.id!==version.id))assert.equal(pane.top,0);
  await evaluate(`document.querySelector('.version-section > summary').click()`);await wait(100);
  state=await metrics();assert.equal(state.panes.find(p=>p.id===version.id).open,false);assert.equal(state.panes.find(p=>p.id===version.id).client,0);
  await evaluate(`document.querySelector('.version-section > summary').click()`);await wait(100);
  state=await metrics();assert.ok(state.panes.find(p=>p.id===version.id).client>0);
  await evaluate(`for (const pane of document.querySelectorAll('#components > details')) { const keep=pane.dataset.section==='module' || pane===document.querySelector('.version-section'); if (pane.open!==keep) pane.querySelector('summary').click(); }`);await wait(150);
  state=await metrics();const short=state.panes.find(p=>p.id==='module');
  assert.equal(short.scroll,short.client,'a short list with sufficient room must not overflow');
  const previousHeight=state.height;
  // Opening the real Problems panel resizes the Webview viewport without
  // depending on an X11 window manager or unsupported Electron Browser APIs.
  await writeJson(directory,'resize.json',{showPanel:true});
  await until(async()=>{state=await metrics();return state.height!==previousHeight;},'Webview panes did not resize with the window.');
  assert.ok(state.panes.filter(p=>p.open).every(p=>p.client>0));
  console.log('Real Webview: independent overflow, native wheel, scrollbar drag, fixed headings and scroll boundaries verified.');
}
async function main() {
  if(typeof WebSocket!=='function')throw Error('test:webview requires Node.js 22 or later.');
  delete process.env.ELECTRON_RUN_AS_NODE;
  const version=process.env.VSCODE_TEST_VERSION||'1.95.3';
  // Finish a possible first-time download before starting the UI timeout.
  const executable=process.env.VSCODE_TEST_EXECUTABLE||await downloadAndUnzipVSCode({version});
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vul-tools-webview-'));
  const profile=path.join(directory,'profile');let cdp,hostError;
  const host=runTests({
    version,vscodeExecutablePath:executable,
    extensionDevelopmentPath:root,extensionTestsPath:path.join(root,'tests/webview-host/index.cjs'),
    extensionTestsEnv:{VUL_WEBVIEW_TEST_DIR:directory},
    launchArgs:[directory,`--user-data-dir=${profile}`,'--remote-debugging-port=0','--disable-gpu','--skip-welcome','--skip-release-notes']
  }).catch(error=>{hostError=error;});
  try {
    const endpoint=await until(async()=>{
      if(hostError)throw hostError;
      try{const [port,route]=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return `ws://127.0.0.1:${port}${route}`;}catch(error){if(error.code==='ENOENT')return;throw error;}
    },'No VS Code DevTools endpoint.');
    cdp=await CDP.connect(endpoint);
    const attached=new Set();
    const findView = condition => until(async()=>{
      if(hostError)throw hostError;
      const {targetInfos}=await cdp.send('Target.getTargets');
      for(const target of targetInfos)if(['page','iframe'].includes(target.type)&&!attached.has(target.targetId)){
        attached.add(target.targetId);
        const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
        await cdp.send('Runtime.enable',{},sessionId);
      }
      for(const value of cdp.contexts.values()) {
        try { if(await cdp.evaluate(value,condition))return value; }catch{}
      }
    },'Could not find the rendered VUL Webview.');
    const context=await findView(`!!document.querySelector('.global-section .component') && typeof window.VulSidebar === 'object'`);
    await verify(cdp,context,directory);
    for(const [kind,title,count] of [['header','Header Contents',1],['testbench','Testbench Contents',2]]) {
      await writeJson(directory,'open.json',{kind});
      const view=await findView(`document.querySelector('.module-section > summary')?.textContent===${JSON.stringify(title)} && !!document.querySelector('.module-section .component')`);
      const pane=await cdp.evaluate(view,`(() => {const b=document.querySelector('.module-section > .declarations'),r=b.getBoundingClientRect();return {count:document.querySelectorAll('#components > details').length,client:b.clientHeight,scroll:b.scrollHeight,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(pane.count,count);assert.ok(pane.scroll>pane.client);
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:pane.x,y:pane.y,deltaX:0,deltaY:120},view.sessionId);await wait(200);
      assert.ok(await cdp.evaluate(view,`document.querySelector('.module-section > .declarations').scrollTop>0`),`${kind} native wheel failed`);
      if(kind==='testbench')assert.equal(await cdp.evaluate(view,`document.querySelector('.global-section > .declarations').scrollTop`),0);
    }
    console.log('Real Webview: Header single-pane and testbench multi-pane native scrolling verified.');
    await writeJson(directory,'result.json',{passed:true});
    await host;if(hostError)throw hostError;
  } catch(error) {
    await writeJson(directory,'result.json',{error:String(error.stack||error)});
    if(cdp)try{await cdp.send('Browser.close');}catch{}
    await host;throw error;
  } finally { if(cdp)cdp.close();await fs.rm(directory,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
