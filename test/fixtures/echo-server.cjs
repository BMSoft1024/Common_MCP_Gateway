// Tiny downstream MCP server used by the end-to-end test. ECHO_EXTRA=1 adds a third tool.
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'echo', version: '1.0.0' }, { capabilities: { tools: {} } });
const schema = { type: 'object', properties: { text: { type: 'string' } } };

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
    { name: 'echo', description: 'Echo text', inputSchema: schema },
    { name: 'secret', description: 'Restricted tool', inputSchema: schema },
    { name: 'slow', description: 'Answers after arguments.ms milliseconds', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } }
  ];
  if (process.env.ECHO_EXTRA === '1') tools.push({ name: 'extra', description: 'Added later', inputSchema: schema });
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'slow') await new Promise((resolve) => setTimeout(resolve, Number(request.params.arguments?.ms) || 0));
  return { content: [{ type: 'text', text: `${request.params.name}:${request.params.arguments?.text ?? ''}:pid=${process.pid}` }] };
});

server.connect(new StdioServerTransport());
