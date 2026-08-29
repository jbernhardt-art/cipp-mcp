import { CIPP_MCP_INSTRUCTIONS } from '../src/mcp/server.js';

describe('CIPP MCP server instructions', () => {
  it('puts the no-shell fallback rule inside the first 512 characters', () => {
    const priorityInstructions = CIPP_MCP_INSTRUCTIONS.slice(0, 512);

    expect(priorityInstructions).toContain("Use only this server's exposed CIPP MCP tools");
    expect(priorityInstructions).toContain('Never use shell commands');
    expect(priorityInstructions).toContain('curl');
    expect(priorityInstructions).toContain('PowerShell');
    expect(priorityInstructions).toContain('Node.js');
    expect(priorityInstructions).toContain('raw HTTP');
    expect(priorityInstructions).toContain('stop and report the limitation');
  });

  it('keeps write confirmation guidance', () => {
    expect(CIPP_MCP_INSTRUCTIONS).toContain('Always confirm destructive operations');
  });
});
