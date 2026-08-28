import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { CippToolHandler } from '../src/handlers/tool.handler.js';
import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';

const users = [
  {
    id: '1',
    accountEnabled: true,
    displayName: 'Alice Member',
    userPrincipalName: 'alice@contoso.com',
    mail: 'alice@contoso.com',
    userType: 'Member',
    jobTitle: 'Engineer',
    department: 'IT',
    usageLocation: 'US',
    assignedLicenses: [{ skuId: 'business-premium' }],
    LicJoined: ['Microsoft 365 Business Premium'],
    hugeUnusedProperty: 'x'.repeat(1000),
  },
  {
    id: '2',
    accountEnabled: false,
    displayName: 'Bob Member',
    userPrincipalName: 'bob@contoso.com',
    mail: null,
    userType: 'Member',
    jobTitle: null,
    department: null,
    usageLocation: 'US',
    assignedLicenses: [],
    LicJoined: [],
    hugeUnusedProperty: 'y'.repeat(1000),
  },
  {
    id: '3',
    accountEnabled: true,
    displayName: 'Guest User',
    userPrincipalName: 'guest_contoso.com#EXT#@contoso.onmicrosoft.com',
    mail: 'guest@example.com',
    userType: 'Guest',
    jobTitle: null,
    department: null,
    usageLocation: null,
    assignedLicenses: [],
    LicJoined: [],
    hugeUnusedProperty: 'z'.repeat(1000),
  },
];

const logger = {
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

function makeHandler() {
  const listUsers = jest.fn(async () => users);
  const service = { listUsers } as unknown as CippService;
  return {
    handler: new CippToolHandler(service, logger, ['cipp_list_users']),
    listUsers,
  };
}

function parseResult(result: Awaited<ReturnType<CippToolHandler['handleToolCall']>>) {
  return JSON.parse(result.content[0].text) as {
    users: Array<Record<string, unknown>>;
    count: number;
    totalMatched: number;
    truncated: boolean;
    responseMode: string;
  };
}

describe('CippToolHandler cipp_list_users output shaping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns compact records by default and omits unrelated large properties', async () => {
    const { handler } = makeHandler();
    const output = parseResult(
      await handler.handleToolCall('cipp_list_users', { tenantFilter: 'contoso.com' })
    );

    expect(output).toMatchObject({
      count: 3,
      totalMatched: 3,
      truncated: false,
      responseMode: 'compact',
    });
    expect(output.users[0]).toHaveProperty('userPrincipalName', 'alice@contoso.com');
    expect(output.users[0]).not.toHaveProperty('hugeUnusedProperty');
  });

  it('combines license, enabled-state, and user-type filters', async () => {
    const { handler } = makeHandler();
    const output = parseResult(
      await handler.handleToolCall('cipp_list_users', {
        tenantFilter: 'contoso.com',
        licensedOnly: true,
        accountEnabled: true,
        userType: 'Member',
      })
    );

    expect(output.count).toBe(1);
    expect(output.users[0].userPrincipalName).toBe('alice@contoso.com');
  });

  it('returns only explicitly selected compact fields', async () => {
    const { handler } = makeHandler();
    const output = parseResult(
      await handler.handleToolCall('cipp_list_users', {
        tenantFilter: 'contoso.com',
        fields: ['userPrincipalName', 'LicJoined'],
      })
    );

    expect(output.users[0]).toEqual({
      userPrincipalName: 'alice@contoso.com',
      LicJoined: ['Microsoft 365 Business Premium'],
    });
  });

  it('returns raw records only when full mode is explicit', async () => {
    const { handler } = makeHandler();
    const output = parseResult(
      await handler.handleToolCall('cipp_list_users', {
        tenantFilter: 'contoso.com',
        responseMode: 'full',
      })
    );

    expect(output.responseMode).toBe('full');
    expect(output.users[0]).toHaveProperty('hugeUnusedProperty');
  });

  it('reports truncation when a limit is applied', async () => {
    const { handler } = makeHandler();
    const output = parseResult(
      await handler.handleToolCall('cipp_list_users', {
        tenantFilter: 'contoso.com',
        limit: 1,
      })
    );

    expect(output).toMatchObject({ count: 1, totalMatched: 3, truncated: true });
  });

  it('rejects field selection in full mode', async () => {
    const { handler } = makeHandler();

    await expect(
      handler.handleToolCall('cipp_list_users', {
        tenantFilter: 'contoso.com',
        responseMode: 'full',
        fields: ['userPrincipalName'],
      })
    ).rejects.toBeInstanceOf(McpError);
  });

  it('keeps exact UPN lookup as one filtered CIPP service call', async () => {
    const { handler, listUsers } = makeHandler();
    await handler.handleToolCall('cipp_list_users', {
      tenantFilter: 'contoso.com',
      searchField: 'userPrincipalName',
      searchValue: 'alice@contoso.com',
      fields: ['userPrincipalName', 'LicJoined'],
    });

    expect(listUsers).toHaveBeenCalledTimes(1);
    expect(listUsers).toHaveBeenCalledWith('contoso.com', {
      searchField: 'userPrincipalName',
      searchValue: 'alice@contoso.com',
    });
  });
});
