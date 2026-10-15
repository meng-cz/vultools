'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, flatten } = require('../out/parser');
const { tokenize } = require('../out/parser/lexer');
const { DocumentSession } = require('../out/session');
const errors = result => result.issues.filter(i => i.severity === 'error');
const valid = (source, kind) => { const result = parse(source, kind); assert.deepEqual(result.issues, []); return result; };

test('named parameters, source values and defaults survive parsing', () => {
  const result = valid('REGISTER(name=counter, ports=2, type=Int<32>);');
  const node = result.components[0];
  assert.equal(node.name, 'counter');
  assert.deepEqual(node.attributes.find(a => a.name === 'dims'), { name: 'dims', value: '[]', explicit: false });
  assert.equal(node.attributes.find(a => a.name === 'type').value, 'Int<32>');
});
test('type commas, nested expressions, dimensions and shifts do not split fields', () => {
  const result = valid('REGISTER(reg, std::array<Int<32>, 4>, ports=(A < B ? 1 : 2), dims=[N, (M >> 1)]);');
  assert.equal(result.components[0].attributes.find(a => a.name === 'type').value, 'std::array<Int<32>, 4>');
});
test('C++ bodies including comments, raw strings and nested braces are opaque and exact', () => {
  const body = '{\r\n // 中文 😀 REGISTER(fake,int);\r\n auto s = R"tag( } REGISTER(no, int); \" )tag";\r\n if (x) { unknown_cpp ???; }\r\n}';
  const result = valid(`TICK_IMPL() ${body}\nREGISTER(real, uint32_t);`);
  assert.equal(result.components.length, 2);
  assert.equal(result.components[0].codeBlocks[0].code, body);
});
test('comments and quotes containing fake declarations do not produce nodes', () => {
  const r = valid('// REGISTER(fake, int);\n/* QUERY(no, int) {} */\nHELPER() { auto s="REGISTER(no,int);"; }');
  assert.equal(r.components.length, 1);
});
test('business parameters and child overrides retain their order', () => {
  const r = valid('REQUEST(fetch, handshake=true, dims=[2,3], ARG(Int<32>) address, RESP(uint32_t) data);\nCHILD_INSTANCE(Node, lane, dims=[4], PARAM(WIDTH)=32, PARAM(ROW)=COORD(0));');
  assert.deepEqual(r.components[0].parameters.map(p => p.direction), ['ARG', 'RESP']);
  assert.deepEqual(r.components[1].overrides.map(a => a.value), ['32', 'COORD(0)']);
});
test('SERVICE ready implies handshake and signatures link to forward declarations', () => {
  const r = valid('SERVICE(push, handshake=true, ARG(uint32_t) data);\nSERVICE(push, ready=ok, ARG(uint32_t) data) { arbitrary(); }');
  assert.deepEqual(r.components[0].relatedIds, [r.components[1].id]);
  assert.equal(r.components[1].attributes.find(a => a.name === 'handshake').value, 'true');
});
test('versions remain isolated and selected implementation is identified', () => {
  const r = valid('INTERFACE() { QUERY(value, uint32_t); } USE_VERSION(two); VERSION(one) { QUERY(value,uint32_t) { return 1; } } VERSION(two) { QUERY(value,uint32_t) { return 2; } }');
  assert.equal(r.components[3].selected, true);
  assert.equal(r.components[2].selected, false);
  assert.equal(r.components[0].children[0].relatedIds.length, 2);
});
test('multiple tick blocks are legitimate', () => {
  assert.equal(valid('TICK_IMPL() {} TICK_IMPL() {}').components.length, 2);
});
test('optional tick names are display labels and do not collide with declarations', () => {
  const r = valid('REGISTER(update,int); TICK_IMPL(update) {} TICK_IMPL(name=update) {} TICK_IMPL() {}');
  assert.deepEqual(r.components.map(node => node.name), ['update', 'update', 'update', 'TICK_IMPL']);
  assert.equal(new Set(r.components.map(node => node.id)).size, 4);
});
test('pipeline endpoints and their reset bodies remain nested', () => {
  const r = valid('PIPELINE(p, 3, IREG(input, Int<32>) { input=1; }, IVALID(iv), OREG(output, Int<32>), OVALID(ov)) { output = input; }');
  assert.equal(r.components[0].children.length, 4);
  assert.equal(r.components[0].children[0].codeBlocks[0].role, 'reset');
  assert.equal(r.components[0].codeBlocks[0].code, '{ output = input; }');
});
test('preprocessor branches are marked without expansion or false duplicate errors', () => {
  const r = valid('#if FLAG\nREGISTER(r, uint32_t);\n#else\nREGISTER(r, uint16_t);\n#endif\n');
  assert.match(r.components[0].condition, /FLAG/);
  assert.match(r.components[1].condition, /else/);
});
test('header and testbench file scopes', () => {
  valid('CONFIG(W,32); ALIAS(Word, Int<W>); STRUCT(Packet) { Word value; };', 'header');
  valid('TOP("Top.vul"); PROJECT("."); GLOBAL() {} SERVICE(out, ARG(uint32_t) x) {} QUERY(status,uint32_t); SIMULATION() {}', 'testbench');
  assert.ok(errors(parse('REGISTER(r,int);', 'header')).length);
  assert.ok(errors(parse('QUERY(status,int) { return 1; }', 'testbench')).length);
});
for (const [name, source, message] of [
  ['required', 'REGISTER(r);', /missing required.*type/],
  ['duplicate', 'REGISTER(r,int,name=x);', /duplicate attribute/],
  ['unknown', 'REGISTER(r,int,portnum=2);', /unknown/],
  ['position', 'REGISTER(name=r,int);', /positional argument after named/],
  ['empty', 'REGISTER(r,,ports=1);', /empty argument/],
  ['empty named', 'CONFIG(name=, value=1);', /cannot be empty/],
  ['business order', 'REQUEST(r, ARG(int) x, handshake=true);', /attributes must precede/],
  ['handshake', 'REQUEST(r, handshake=yes);', /handshake must/],
  ['ready conflict', 'SERVICE(s, handshake=false, ready=true) {}', /conflicts/],
  ['ready forward', 'SERVICE(s, ready=true);', /forward declarations/],
  ['ready missing', 'SERVICE(s, handshake=true) {}', /require ready/],
  ['dims', 'REGISTER(r,int,dims=4);', /dims must/],
  ['zero dimension', 'REGISTER(r,int,dims=[2,0]);', /positive constant/],
  ['BRAM mode', 'BRAM(m,int,32,mode=wrong);', /mode must/],
  ['BRAM ports', 'BRAM(m,int,32,read_ports=2,mode=1rw);', /requires one/],
  ['body required', 'WIRE(w,int);', /requires a code block/],
  ['body forbidden', 'REQUEST(r) {}', /cannot have a code block/],
  ['endpoint scope', 'OREG(o,int);', /not allowed/],
  ['endpoint attribute', 'PIPELINE(p,1,IREG(i,int),OREG(o,int,ports=1)) {}', /unknown/],
  ['endpoint reset', 'PIPELINE(p,1,IREG(i,int),OREG(o,int) {}) {}', /cannot have/],
  ['valid reset', 'PIPELINE(p,1,IREG(i,int),IVALID(iv) {},OREG(o,int),OVALID(ov)) {}', /cannot have/],
  ['valid pair', 'PIPELINE(p,1,IREG(i,int),IVALID(iv),OREG(o,int)) {}', /paired/],
  ['interface scope', 'INTERFACE() { REGISTER(r,int); }', /not allowed/],
  ['version missing', 'INTERFACE() {} USE_VERSION(missing); VERSION(other) {}', /does not exist/],
  ['signature', 'QUERY(q,int); QUERY(q,bool) { return true; }', /signatures differ/],
  ['duplicate component', 'REGISTER(r,int); REGISTER(r,int);', /Duplicate declaration/],
  ['override duplicate', 'CHILD_INSTANCE(Node,n,PARAM(W)=1,PARAM(W)=2);', /Duplicate parameter override/],
  ['business signature', 'REQUEST(r,ARG(int));', /expected ARG/],
  ['semicolon', 'REGISTER(r,int)\nREGISTER(s,int);', /requires a semicolon/]
]) test(`rejects ${name} declaration errors`, () => {
  assert.ok(errors(parse(source)).some(i => message.test(i.message)), JSON.stringify(parse(source).issues));
});
test('recovers next component after malformed arguments', () => {
  const r = parse('REGISTER(broken, int;\nREGISTER(good,uint32_t);');
  assert.ok(r.issues.length);
  assert.ok(r.components.some(c => c.name === 'good'));
});
test('reports incomplete block and unterminated lexemes', () => {
  assert.match(parse('TICK_IMPL() {').issues[0].message, /unclosed/);
  assert.match(tokenize('/* incomplete').issues[0].message, /Unterminated/);
  assert.match(tokenize('R"x(incomplete').issues[0].message, /Unterminated/);
});
test('source spans use JavaScript UTF-16 offsets with CRLF and non-BMP text', () => {
  const source = '// 中文 😀\r\nREGISTER(r,int);';
  const node = valid(source).components[0];
  assert.equal(node.start, source.indexOf('REGISTER'));
  assert.equal(source.slice(node.start,node.end), 'REGISTER(r,int);');
});
test('document snapshots stay stale until refreshed and bind to current version', () => {
  const state = new DocumentSession();
  state.refresh('REGISTER(old,int);', 1, 'module'); state.invalidate(2);
  assert.equal(state.stale, true); assert.equal(state.result.components[0].name, 'old');
  state.refresh('REGISTER(new,int);', 2, 'module');
  assert.equal(state.stale, false); assert.equal(state.version, 2); assert.equal(state.result.components[0].name, 'new');
});
for (const name of ['querydemo','prodcon','array1d']) test(`real migrated ${name} declarations parse without errors`, () => {
  const dir = path.join(__dirname,'../examples',name);
  for (const file of fs.readdirSync(dir).filter(f => /\.(vul|utb)$/.test(f))) {
    const r = parse(fs.readFileSync(path.join(dir,file),'utf8'), file.endsWith('.utb') ? 'testbench' : 'module');
    assert.deepEqual(r.issues, [], `${name}/${file}: ${JSON.stringify(r.issues)}`);
    assert.ok(flatten(r.components).length);
  }
});
test('incomplete C++ parentheses do not cause a declaration syntax error', () => {
  const r = valid('TICK_IMPL() { if ( invalid_cpp[; } REGISTER(real,int);');
  assert.equal(r.components.length, 2);
});
test('comments inside identifier arguments do not invalidate declarations', () => {
  valid('REGISTER(count /* declaration name */, uint32_t);');
});
test('rejects adjacent dimension lists and missing macro parentheses', () => {
  assert.ok(errors(parse('REGISTER(r,int,dims=[2][3]);')).some(i => /dims must/.test(i.message)));
  assert.ok(errors(parse('REGISTER r;')).some(i => /parentheses/.test(i.message)));
});
test('literal and name comments are ignored for declaration validation', () => {
  const r = valid('REQUEST(name=out /* name */, handshake=true /* handshake */);');
  assert.equal(r.components[0].name, 'out');
  assert.equal(r.components[0].attributes[0].value, 'out');
});
test('a forward declaration can have only one implementation in a scope', () => {
  const r = parse('QUERY(q,int); QUERY(q,int) {} QUERY(q,int) {}');
  assert.ok(r.issues.some(i => /Duplicate declaration/.test(i.message)));
});
test('pipeline reset bodies also keep malformed C++ parentheses opaque', () => {
  const r = valid('PIPELINE(p,1,IREG(i,int) { i=(; },OREG(o,int)) { o=i; }');
  assert.equal(r.components[0].children.length, 2);
});
test('signature comparison normalizes boolean literals, whitespace and comments', () => {
  valid('SERVICE(s,handshake=true,ARG(Int</*width*/32>) x); SERVICE(s,handshake=1,ready=true,ARG(Int<32>) x) {}');
});
test('an explicitly declared SERVICE priority must be repeated', () => {
  assert.ok(parse('SERVICE(s,priority=2); SERVICE(s) {}').issues.some(i => /repeat the declared priority/.test(i.message)));
});
test('conditional container alternatives do not create false duplicate interfaces', () => {
  const r = valid('#if A\nINTERFACE() { REQUEST(a); }\n#else\nINTERFACE() { REQUEST(b); }\n#endif\n');
  assert.equal(r.components.length, 2);
  assert.ok(r.components.every(c => c.condition));
});
