import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../src/utils/logger.js';

describe('Logger persistent audit file', () => {
  it('writes MCP audit events but excludes ordinary application messages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cipp-mcp-audit-'));
    const filename = join(directory, 'audit.log');

    try {
      const logger = new Logger('info', 'json', {
        filename,
        maxSizeBytes: 1024 * 1024,
        maxFiles: 2,
      });
      logger.info('MCP tool call completed', {
        event: 'mcp_tool_call_completed',
        callerId: 'engineer-one',
        tool: 'cipp_ping',
        outcome: 'success',
      });
      logger.info('Ordinary application message');
      await logger.close();

      const content = readFileSync(filename, 'utf8');
      expect(content).toContain('mcp_tool_call_completed');
      expect(content).toContain('engineer-one');
      expect(content).not.toContain('Ordinary application message');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
