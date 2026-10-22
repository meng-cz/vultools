'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { posix } = require('node:path');
const { locateProject, HeaderParser } = require('../out/project');
const { parse } = require('../out/parser');
function memory(files) {
  const data = new Map(Object.entries(files));
  const directories = new Set(['/']);
  for (const file of data.keys()) for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    directories.add(dir); if (dir === '/') break;
  }
  const io = {
    parent: posix.dirname, join: posix.join, resolve: posix.resolve,
    async stat(uri) { return data.has(uri) ? 'file' : directories.has(uri) ? 'directory' : undefined; },
    async entries(dir) {
      return [...new Set([...directories, ...data.keys()])].filter(p => p !== dir && posix.dirname(p) === dir)
        .map(p => [posix.basename(p), directories.has(p) ? 'directory' : 'file']);
    },
    async source(uri) { if (!data.has(uri)) throw Error('unreadable'); return { text: data.get(uri), version: 1, dirty: false }; }
  };
  return { io, data, directories };
}
test('project priority is setting, module PROJECT, then nearest ancestor Header', async () => {
  const { io } = memory({ '/ws/header.h': '', '/ws/app/header.hpp': '', '/chosen/header.h': '' });
  const components = parse('PROJECT("../chosen");').components;
  assert.equal((await locateProject(io, '/ws/app/Top.vul', components, '/chosen', '/ws')).root, '/chosen');
  assert.equal((await locateProject(io, '/ws/app/Top.vul', components, 'custom', '/ws')).root, '/ws/custom');
  assert.equal((await locateProject(io, '/ws/app/Top.vul', components, '', '/ws')).root, '/ws/chosen');
  assert.equal((await locateProject(io, '/ws/app/src/Top.vul', [], '', '/ws')).root, '/ws/app');
  assert.match((await locateProject(io, '/ws/app/Top.vul', [], 'relative')).error, /workspace/);
});
test('invalid explicit binding never falls back; strings and C++ bodies cannot bind PROJECT', async () => {
  const { io } = memory({ '/ws/header.hpp': '' });
  for (const source of ['PROJECT(PATH);', 'PROJECT("."); PROJECT("..");', 'PROJECT("");']) {
    assert.match((await locateProject(io, '/ws/Top.vul', parse(source).components, '')).error, /PROJECT/);
  }
  const location = await locateProject(io, '/ws/Top.vul', parse('HELPER() { PROJECT("/fake"); auto s="PROJECT(\\"/fake\\")"; } // PROJECT("/fake");').components, '');
  assert.equal(location.root, '/ws');
  const missing = await locateProject(io, '/ws/Top.vul', parse('PROJECT("/missing");').components, '');
  assert.equal(missing.root, '/missing');
  assert.match((await new HeaderParser().load(io, missing.root)).messages[0], /directory/);
});
test('module PROJECT permits positional and named strings only at module top level', () => {
  for (const source of ['PROJECT(".");', 'PROJECT(path="../project");']) assert.deepEqual(parse(source).issues, []);
  assert.ok(parse('PROJECT("."); PROJECT(".");').issues.length);
  assert.ok(parse('INTERFACE() { PROJECT("."); }').issues.length);
  assert.ok(parse('VERSION(v) { PROJECT("."); } USE_VERSION(v);').issues.length);
});
test('Header directories recurse, preserve separate sources, sort relative names and recover errors', async () => {
  const { io } = memory({
    '/p/header/z/types.hpp': 'CONFIG(WIDTH,32);', '/p/header/a/types.hpp': 'ALIAS(Word,uint32_t);',
    '/p/header/notes.txt': 'CONFIG(IGNORE,1);', '/p/header/broken.h': 'ALIAS(Broken); CONFIG(Good,1);'
  });
  const result = await new HeaderParser().load(io, '/p');
  assert.equal(result.mode, 'directory');
  assert.deepEqual(result.files.map(f => f.filename), ['a/types.hpp', 'broken.h', 'z/types.hpp']);
  assert.equal(result.files[0].result.components[0].name, 'Word');
  assert.ok(result.files[1].result.issues.length);
  assert.equal(result.files[1].result.components.at(-1).name, 'Good');
});
test('single-file Header layout and conflicts are explicit', async () => {
  const single = memory({ '/p/header.h': 'CONFIG(N,8);' });
  assert.equal((await new HeaderParser().load(single.io, '/p')).mode, 'file');
  for (const files of [ { '/p/header.h':'', '/p/header.hpp':'' }, { '/p/header/a.h':'', '/p/header.hpp':'' } ]) {
    const result = await new HeaderParser().load(memory(files).io, '/p');
    assert.equal(result.files.length, 0); assert.match(result.messages[0], /Conflicting/);
  }
});
test('Header parsing prefers adapter buffers, caches exact text and removes deleted files', async () => {
  const { io, data } = memory({ '/p/header/a.h': 'CONFIG(N,8);', '/p/header/b.h': 'CONFIG(M,4);' });
  const parser = new HeaderParser(); const first = await parser.load(io, '/p');
  const again = await parser.load(io, '/p');
  assert.equal(first.files[0].result, again.files[0].result);
  io.source = async uri => ({ text: uri.endsWith('a.h') ? 'CONFIG(N,16);' : data.get(uri), dirty: true, version: 12 });
  const dirty = await parser.load(io, '/p');
  assert.equal(dirty.files[0].dirty, true); assert.equal(dirty.files[0].version, 12);
  assert.equal(dirty.files[0].result.components[0].attributes[1].value, '16');
  data.delete('/p/header/b.h');
  assert.equal((await parser.load(io, '/p')).files.length, 1);
});
test('unreadable Header does not suppress other files and a project can be absent', async () => {
  const { io } = memory({ '/p/header/a.h':'', '/p/header/b.h':'CONFIG(B,1);' });
  const source = io.source;
  io.source = async uri => { if (uri.endsWith('a.h')) throw Error('permission denied'); return source(uri); };
  const result = await new HeaderParser().load(io, '/p');
  assert.match(result.files[0].error, /permission denied/);
  assert.equal(result.files[1].result.components[0].name, 'B');
  assert.equal((await locateProject(io, '/other/Top.vul', [], '')).root, undefined);
});
