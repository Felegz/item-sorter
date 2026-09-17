const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const menu = require('../sorter 2025/task-action-menu.js');
// Desktop edges, mobile width, and a keyboard-reduced visible viewport.
for (const v of [{left:0,top:0,width:1440,height:900}, {left:0,top:0,width:390,height:844}, {left:0,top:120,width:390,height:280}]) {
  for (const a of [{left:0,top:v.top,right:20,bottom:v.top+30}, {left:v.width-30,top:v.top+v.height-30,right:v.width,bottom:v.top+v.height}]) {
    const p = menu.place(a, {width:230,height:420}, v);
    assert(p.left >= v.left && p.top >= v.top);
    assert(p.left+p.width <= v.left+v.width);
    assert(p.top+p.height <= v.top+v.height);
  }
}
const events = {};
const docEvents = {};
let stored = 'Задача один', text = stored, draft = '', connected = false, answer = false, prompts = 0;
const context = {
  document: {getElementById: () => ({value:text}), addEventListener: (name, cb) => {docEvents[name]=cb;}},
  SorterRuntime: {getTasks: () => stored, isDeveloperMode:false},
  localStorage: {getItem: () => 'Задача один'},
  getToken: () => connected ? 'mock' : null,
  addEventListener: (name, cb) => {events[name]=cb;},
  confirm: () => {prompts++;return answer;}, URL, location:{href:'http://localhost/tasks.html',origin:'http://localhost',pathname:'/tasks.html',search:''}, setTimeout:()=>{},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('sorter 2025/unsaved-changes.js','utf8'),context);
const guard = context.SorterUnsavedChanges;
async function run() {
guard.register('editor',()=>draft);
assert.equal(await guard.allowReplace('clean replacement'),true);
draft = 'edited task';
assert.equal(await guard.allowReplace(stored),false, 'even identical documents must not discard an editor draft');
let prevented = false;
events.beforeunload({preventDefault(){prevented=true;}});
assert(prevented);
const approval = guard.state();
assert.equal(await guard.allowReplace('new version',approval),true);
draft = 'changed during fetch';
assert.equal(await guard.allowReplace('new version',approval),false);
draft = ''; text = 'unpersisted main-list text';
assert.equal(await guard.allowReplace('new version'),false);
text = stored = 'saved locally'; connected = true;
assert.equal(await guard.allowReplace('remote version'),false);
assert.equal(await guard.allowReplace(stored),true);
answer = true;
assert.equal(await guard.allowReplace('remote version'),true);
assert(prompts >= 4);
const html = fs.readFileSync('sorter 2025/tasks.html','utf8');
assert(!html.includes('src="https://unpkg.com/vanilla-context-menu'));
assert(html.includes('if (!window.getSelection().isCollapsed) return;'));
const dropbox = fs.readFileSync('sorter 2025/dropbox.js','utf8');
assert(dropbox.indexOf('allowReplace(text, approvedState)') < dropbox.indexOf('SorterRuntime.setTasks(text)',dropbox.indexOf('async function dbxAutoDownload')));
// Exercise the actual download function with an in-memory response, never Dropbox.
let writes = 0, snapshots = 0, reloads = 0;
context.window = context;
context.DROPBOX_FILE_PATH = '/mock-only.txt';
context.setDbxStatus = () => {};
context.saveSnapshot = () => {snapshots++;};
context.SorterRuntime.setTasks = () => {writes++;};
context.SorterRuntime.setItem = () => {writes++;};
context._onDbxLoad = () => {reloads++;};
context.fetch = async () => {
  draft = 'typed while download was in flight';
  return {ok:true, text:async()=> 'remote text',headers:{get:()=> '{}'}};
};
context.updateDropboxUI = () => {};
context.console = console;
vm.runInContext(dropbox.slice(dropbox.indexOf('async function dbxAutoDownload'),dropbox.indexOf('// ─── Автосохранение')), context);
answer = false;
const beforeFetch = guard.state();
assert.equal(await context.dbxAutoDownload('mock',beforeFetch),false);
assert.equal(writes,0, 'cancel must not change tasks, backups, or revision');
assert.equal(snapshots,0);
assert.equal(reloads,0);
let stopped = false;
const hrefBefore = context.location.href;
await docEvents.click({button:0,target:{closest:()=>({href:'http://localhost/',hasAttribute:()=>false})},preventDefault(){stopped=true;},stopImmediatePropagation(){}});
assert(stopped);
assert.equal(context.location.href,hrefBefore);
console.log('PASS task-menu bounds and unsaved drafts/cloud/race guards');
}
run().catch(error => {console.error(error);process.exitCode=1;});
