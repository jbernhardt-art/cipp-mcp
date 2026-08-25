import { READ_ONLY_TOOL_NAMES, TOOL_DEFINITIONS } from '../src/mcp/tool.definitions.js';

describe('read-only MCP tool annotations', () => {
  it('marks every declared read-only tool consistently', () => {
    const definitions = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

    for (const name of READ_ONLY_TOOL_NAMES) {
      const tool = definitions.get(name);
      expect(tool).toBeDefined();
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it('does not accidentally classify a known write tool as read-only', () => {
    const writeTool = TOOL_DEFINITIONS.find(
      (tool) => tool.name === 'cipp_modify_distribution_group_member'
    );

    expect(writeTool?.annotations?.readOnlyHint).toBe(false);
  });
});
