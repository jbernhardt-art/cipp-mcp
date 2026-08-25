import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { CippToolHandler, redactSensitiveValues } from '../src/handlers/tool.handler.js';
import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';

const service = {
  ping: jest.fn(async () => ({ ok: true })),
} as unknown as CippService;

const logger = {
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

describe('CippToolHandler security policy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes only the safe read-only tools by default', () => {
    const handler = new CippToolHandler(service, logger);
    expect(handler.getToolDefinitions().map((tool) => tool.name)).toEqual([
      'cipp_list_tenants',
      'cipp_ping',
      'cipp_get_version',
    ]);
  });

  it('rejects a direct call to a tool outside the allowlist', async () => {
    const handler = new CippToolHandler(service, logger);
    await expect(
      handler.handleToolCall('cipp_reset_password', {
        tenantFilter: 'contoso.com',
        userId: 'user@contoso.com',
      })
    ).rejects.toBeInstanceOf(McpError);
  });

  it('redacts sensitive values recursively before logging', () => {
    expect(
      redactSensitiveValues({
        password: 'Password1!',
        nested: { newPassword: 'Password2!', apiToken: 'token-value', displayName: 'Alice' },
      })
    ).toEqual({
      password: '[REDACTED]',
      nested: { newPassword: '[REDACTED]', apiToken: '[REDACTED]', displayName: 'Alice' },
    });
  });

  it('logs a redacted argument object for an enabled write tool', async () => {
    const resetPassword = jest.fn(async () => ({ ok: true }));
    const writeService = { resetPassword } as unknown as CippService;
    const handler = new CippToolHandler(writeService, logger, ['cipp_reset_password']);

    await handler.handleToolCall('cipp_reset_password', {
      tenantFilter: 'contoso.com',
      userId: 'user@contoso.com',
      newPassword: 'Password3!',
    });

    expect(logger.debug).toHaveBeenCalledWith('Dispatching tool call: cipp_reset_password', {
      args: {
        tenantFilter: 'contoso.com',
        userId: 'user@contoso.com',
        newPassword: '[REDACTED]',
      },
    });
  });

  it('dispatches the narrow distribution-list membership tool', async () => {
    const modifyDistributionGroupMember = jest.fn(async () => ({ status: 'modified' }));
    const writeService = { modifyDistributionGroupMember } as unknown as CippService;
    const handler = new CippToolHandler(writeService, logger, [
      'cipp_modify_distribution_group_member',
    ]);

    await handler.handleToolCall('cipp_modify_distribution_group_member', {
      tenantFilter: 'contoso.com',
      groupId: '11111111-1111-4111-8111-111111111111',
      memberUserPrincipalName: 'alice@contoso.com',
      action: 'add',
    });

    expect(modifyDistributionGroupMember).toHaveBeenCalledWith(
      'contoso.com',
      '11111111-1111-4111-8111-111111111111',
      'alice@contoso.com',
      'add'
    );
  });
});
