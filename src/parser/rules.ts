export interface Rule {
  fields: string[];
  defaults?: Record<string, string>;
  optional?: string[];
  tail?: 'business' | 'overrides' | 'endpoints';
  body?: 'required' | 'optional' | 'container';
  category: string;
}
const types = 'Parameters and Types', resources = 'State and Resources', interfaces = 'Interfaces';
export const rules: Record<string, Rule> = {
  CONFIG: { fields: ['name', 'value'], category: types },
  PARAMETER: { fields: ['name', 'value'], category: types },
  STRUCT: { fields: ['name'], body: 'required', category: types },
  ENUM: { fields: ['name'], body: 'required', category: types },
  ALIAS: { fields: ['name', 'type', 'dims'], defaults: { dims: '[]' }, category: types },
  REGISTER: { fields: ['name', 'type', 'ports', 'dims'], defaults: { ports: '1', dims: '[]' }, body: 'optional', category: resources },
  WIRE: { fields: ['name', 'type'], body: 'required', category: resources },
  REQUEST: { fields: ['name', 'handshake', 'dims'], defaults: { handshake: 'false', dims: '[]' }, tail: 'business', category: interfaces },
  SERVICE: { fields: ['name', 'handshake', 'dims', 'priority', 'ready'], defaults: { handshake: 'false', dims: '[]', priority: '0' }, optional: ['ready'], tail: 'business', body: 'optional', category: interfaces },
  QUERY: { fields: ['name', 'type'], body: 'optional', category: interfaces },
  CHILD_INSTANCE: { fields: ['module', 'name', 'dims'], defaults: { dims: '[]' }, tail: 'overrides', category: 'Submodules and Connections' },
  USE_CHILD_SERVICE: { fields: ['instance', 'service', 'alias', 'dims'], defaults: { dims: '(inferred)' }, tail: 'business', category: 'Submodules and Connections' },
  USE_CHILD_QUERY: { fields: ['instance', 'query', 'alias', 'type', 'dims'], defaults: { dims: '(inferred)' }, category: 'Submodules and Connections' },
  BRAM: { fields: ['name', 'type', 'size', 'read_ports', 'write_ports', 'mode'], defaults: { read_ports: '1', write_ports: '1', mode: 'generic' }, category: resources },
  ROM: { fields: ['name', 'data_width', 'size', 'read_ports', 'init'], defaults: { read_ports: '1' }, category: resources },
  QUEUE: { fields: ['name', 'type', 'depth', 'enq_width', 'deq_width'], defaults: { enq_width: '1', deq_width: '1' }, category: resources },
  CONNECT_CR_CS: { fields: ['srcchild', 'srcreq', 'dstchild', 'dstserv'], category: 'Submodules and Connections' },
  CONNECT_CR_S: { fields: ['srcchild', 'srcreq', 'dstserv'], category: 'Submodules and Connections' },
  CONNECT_CR_R: { fields: ['srcchild', 'srcreq', 'dstreq'], category: 'Submodules and Connections' },
  CONNECT_S_CS: { fields: ['srcserv', 'dstchild', 'dstserv'], category: 'Submodules and Connections' },
  PIPELINE: { fields: ['name', 'latency'], tail: 'endpoints', body: 'required', category: 'Pipelines' },
  IREG: { fields: ['name', 'type', 'ports'], defaults: { ports: '1' }, body: 'optional', category: 'Endpoints' },
  OREG: { fields: ['name', 'type'], category: 'Endpoints' },
  IVALID: { fields: ['name', 'ports'], defaults: { ports: '1' }, category: 'Endpoints' },
  OVALID: { fields: ['name'], category: 'Endpoints' },
  INTERFACE: { fields: [], body: 'container', category: 'Interface' },
  VERSION: { fields: ['name'], body: 'container', category: 'Versions' },
  USE_VERSION: { fields: ['name'], category: 'Versions' },
  TOP: { fields: ['path'], category: 'Project Binding' },
  PROJECT: { fields: ['path'], category: 'Project Binding' },
  HELPER: { fields: [], body: 'required', category: 'Behavior and Helpers' },
  TICK_IMPL: { fields: ['name'], optional: ['name'], body: 'required', category: 'Behavior and Helpers' },
  GLOBAL: { fields: [], body: 'required', category: 'Simulation' },
  SIMULATION: { fields: [], body: 'required', category: 'Simulation' }
};
export const endpoints = new Set(['IREG', 'OREG', 'IVALID', 'OVALID']);
export const headerKinds = new Set(['CONFIG', 'STRUCT', 'ENUM', 'ALIAS', 'HELPER']);
export const testbenchKinds = new Set([...headerKinds, 'PARAMETER', 'TOP', 'PROJECT', 'REQUEST', 'SERVICE', 'QUERY', 'GLOBAL', 'SIMULATION']);
