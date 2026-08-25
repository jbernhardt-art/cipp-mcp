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
  const expected = ['cipp_get_version', 'cipp_list_tenants', 'cipp_ping'];

  if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected exposed tools: ${toolNames.join(', ')}`);
  }

  for (const name of expected) {
    const result = await client.callTool({ name, arguments: {} });
    if (result.isError) {
      throw new Error(`${name} returned an MCP error`);
    }
    console.log(`${name}: OK`);
  }
} finally {
  await client.close();
}
