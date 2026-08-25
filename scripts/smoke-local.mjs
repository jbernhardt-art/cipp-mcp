import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--env-file=.env.local', 'dist/entry.js'],
  cwd: process.cwd(),
});

const client = new Client({ name: 'cipp-local-smoke-test', version: '1.0.0' });

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const safeCalls = ['cipp_get_version', 'cipp_list_tenants', 'cipp_ping'];
  const missing = safeCalls.filter((name) => !toolNames.includes(name));

  if (missing.length > 0) {
    throw new Error(`Missing required connection-test tools: ${missing.join(', ')}`);
  }

  console.log(`Tool discovery: OK (${toolNames.length} exposed)`);

  // Never invoke write tools from the smoke test. Additional allowlisted tools
  // are expected as the local deployment grows.
  for (const name of safeCalls) {
    const result = await client.callTool({ name, arguments: {} });
    if (result.isError) {
      throw new Error(`${name} returned an MCP error`);
    }
    console.log(`${name}: OK`);
  }
} finally {
  await client.close();
}
