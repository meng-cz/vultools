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
  const { io } = memory({ '/ws/header.uh': '', '/ws/app/header.uh': '', '/chosen/header.uh': '' });
  const components = parse('PROJECT("../chosen");').components;
  assert.equal((await locateProject(io, '/ws/app/Top.vul', components, '/chosen', '/ws')).root, '/chosen');
  assert.equal((await locateProject(io, '/ws/app/Top.vul', components, 'custom', '/ws')).root, '/ws/custom');
  assert.equal((await locateProject(io, '/ws/app/Top.vul', components, '', '/ws')).root, '/ws/chosen');
  assert.equal((await locateProject(io, '/ws/app/src/Top.vul', [], '', '/ws')).root, '/ws/app');
  assert.match((await locateProject(io, '/ws/app/Top.vul', [], 'relative')).error, /workspace/);
});
test('invalid explicit binding never falls back; strings and C++ bodies cannot bind PROJECT', async () => {
  const { io } = memory({ '/ws/header.uh': '' });
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
    '/p/header/z/types.uh': 'CONFIG(WIDTH,32);', '/p/header/a/types.uh': 'ALIAS(Word,uint32_t);',
    '/p/header/notes.txt': 'CONFIG(IGNORE,1);', '/p/header/broken.uh': 'ALIAS(Broken); CONFIG(Good,1);'
  });
  const result = await new HeaderParser().load(io, '/p');
  assert.equal(result.mode, 'directory');
  assert.deepEqual(result.files.map(f => f.filename), ['a/types.uh', 'broken.uh', 'z/types.uh']);
  assert.equal(result.files[0].result.components[0].name, 'Word');
  assert.ok(result.files[1].result.issues.length);
  assert.equal(result.files[1].result.components.at(-1).name, 'Good');
});
test('single-file Header layout and conflicts are explicit', async () => {
  const single = memory({ '/p/header.uh': 'CONFIG(N,8);' });
  assert.equal((await new HeaderParser().load(single.io, '/p')).mode, 'file');
  for (const files of [ { '/p/header/a.uh':'', '/p/header.uh':'' } ]) {
    const result = await new HeaderParser().load(memory(files).io, '/p');
    assert.equal(result.files.length, 0); assert.match(result.messages[0], /Conflicting/);
  }
});
test('Header parsing prefers adapter buffers, caches exact text and removes deleted files', async () => {
  const { io, data } = memory({ '/p/header/a.uh': 'CONFIG(N,8);', '/p/header/b.uh': 'CONFIG(M,4);' });
  const parser = new HeaderParser(); const first = await parser.load(io, '/p');
  const again = await parser.load(io, '/p');
  assert.equal(first.files[0].result, again.files[0].result);
  io.source = async uri => ({ text: uri.endsWith('a.uh') ? 'CONFIG(N,16);' : data.get(uri), dirty: true, version: 12 });
  const dirty = await parser.load(io, '/p');
  assert.equal(dirty.files[0].dirty, true); assert.equal(dirty.files[0].version, 12);
  assert.equal(dirty.files[0].result.components[0].attributes[1].value, '16');
  data.delete('/p/header/b.uh');
  assert.equal((await parser.load(io, '/p')).files.length, 1);
});
test('unreadable Header does not suppress other files and a project can be absent', async () => {
  const { io } = memory({ '/p/header/a.uh':'', '/p/header/b.uh':'CONFIG(B,1);' });
  const source = io.source;
  io.source = async uri => { if (uri.endsWith('a.uh')) throw Error('permission denied'); return source(uri); };
  const result = await new HeaderParser().load(io, '/p');
  assert.match(result.files[0].error, /permission denied/);
  assert.equal(result.files[1].result.components[0].name, 'B');
  assert.equal((await locateProject(io, '/other/Top.vul', [], '')).root, undefined);
});

test('legacy C++ Headers neither bind a project nor conflict with migrated .uh files', async () => {
  const { io } = memory({
    '/p/header.hpp': 'CONFIG(OLD,1);', '/p/header.h': 'CONFIG(OLDER,1);',
    '/p/header/new.uh': 'CONFIG(CURRENT,2);', '/p/header/old.hpp': 'CONFIG(IGNORE,3);'
  });
  const parser = new HeaderParser();
  let result = await parser.load(io, '/p');
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.files.map(file => file.filename), ['new.uh']);
  const legacy = memory({ '/p/header.hpp': 'CONFIG(OLD,1);', '/p/header.h': 'CONFIG(OLDER,1);' });
  assert.equal((await locateProject(legacy.io, '/p/Top.vul', [], '')).root, undefined);
  const migrated = memory({ '/p/header.hpp':'CONFIG(OLD,1);', '/p/header.uh':'CONFIG(CURRENT,2);' });
  result = await parser.load(migrated.io, '/p');
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.files.map(file => file.filename), ['header.uh']);
});
