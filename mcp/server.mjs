import {numberPreservingJson} from '../finite_world.mjs';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {serverContext, shutdown} from './context.mjs';
import {authoring} from './authoring.mjs';
import {jobs} from './jobs.mjs';
import {inspection} from './inspection.mjs';
import {more} from './more.mjs';
import {worlds} from '../studio/catalog.mjs';
const [flag, workspace, ...rest] = process.argv.slice(2);
if (flag !== '--workspace' || !workspace || rest.length)
  throw Error('usage: node mcp/server.mjs --workspace OWNER_CONTROLLED_DIRECTORY');
const ctx = serverContext(workspace, JSON.parse(process.env.BEND_MCP_NODE_MAP ?? '{}'));
const tools = {...authoring, ...jobs, ...inspection, ...more};
const ajv = new Ajv({allErrors: false});
const validators = new Map(Object.entries(tools).map(([k, t]) => [k, ajv.compile(t.inputSchema)]));
const resources = {
  'bend://docs/experiments': ['Experiments guide', 'text/markdown', 'EXPERIMENTS.md'],
  'bend://docs/fields': ['Plan and spec field reference', 'text/markdown', 'mcp/FIELDS.md'],
  'bend://docs/laws': ['Bend laws', 'text/plain', 'LAWS.bend'],
  'bend://studio/catalog': ['Studio catalog', 'application/json', null],
};
const server = new Server(
  {name: 'bend-agent-studio', version: '1.0.0'},
  {capabilities: {tools: {}, resources: {}}},
);
server.setRequestHandler(ListResourcesRequestSchema, () => ({
  resources: Object.entries(resources).map(([uri, [name, mimeType]]) => ({uri, name, mimeType})),
}));
server.setRequestHandler(ReadResourceRequestSchema, ({params: {uri}}) => {
  if (!Object.hasOwn(resources, uri)) throw Error('unknown resource');
  const [, mimeType, file] = resources[uri];
  return {
    contents: [
      {
        uri,
        mimeType,
        text: file ? fs.readFileSync(path.join(ctx.repo, file), 'utf8') : JSON.stringify(worlds),
      },
    ],
  };
});
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: Object.entries(tools).map(([name, {description, inputSchema, readOnly}]) => ({
    name,
    description,
    inputSchema,
    annotations: {readOnlyHint: readOnly, openWorldHint: false},
  })),
}));
let pending = 0;
server.setRequestHandler(CallToolRequestSchema, async ({params: {name, arguments: a = {}}}) => {
  let counted = false;
  try {
    const validate = validators.get(name);
    if (!validate) throw Error('unknown tool');
    if (!validate(a)) throw Error(ajv.errorsText(validate.errors));
    if (pending >= 8 && name !== 'cancel_job') throw Error('too many concurrent tool calls');
    ++pending;
    counted = true;
    let data = await tools[name].run(a, ctx);
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {result: data};
    const text = numberPreservingJson(data);
    if (Buffer.byteLength(text) > 2 ** 20) throw Error('response exceeds 1 MiB');
    return {structuredContent: data, content: [{type: 'text', text}]};
  } catch (e) {
    const error = String(e.message).slice(0, 4096);
    return {isError: true, structuredContent: {error}, content: [{type: 'text', text: error}]};
  } finally {
    if (counted) --pending;
  }
});
server.onclose = shutdown;
const transport = new StdioServerTransport(process.stdin, process.stdout, {maxBufferSize: 2 ** 20});
process.stdin.once('end', () => {
  shutdown();
  void server.close();
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('exit', shutdown);
await server.connect(transport);
