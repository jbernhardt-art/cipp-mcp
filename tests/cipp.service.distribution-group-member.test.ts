import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('error');
const groupId = '11111111-1111-4111-8111-111111111111';

function jsonResponse(payload: unknown): Response {
  const text = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    text: async () => text,
  } as Response;
}

function distributionList(overrides: Record<string, unknown> = {}) {
  return {
    groupInfo: {
      id: groupId,
      displayName: 'Support Alerts',
      groupType: 'Distribution List',
      mailEnabled: true,
      securityEnabled: false,
      groupTypes: [],
      onPremisesSyncEnabled: false,
      ...overrides,
    },
  };
}

describe('CippService modifyDistributionGroupMember', () => {
  let service: CippService;

  beforeEach(() => {
    service = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['add', 'addMember'],
    ['remove', 'removeMember'],
  ] as const)('verifies the group and maps %s to %s for one user', async (action, cippAction) => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>((url, init) => {
      if (url.includes('/api/ListGroups')) return Promise.resolve(jsonResponse(distributionList()));
      if (url.includes('/api/ListUsers')) {
        return Promise.resolve(
          jsonResponse([{ id: '22222222-2222-4222-8222-222222222222', userPrincipalName: 'Alice@contoso.com' }])
        );
      }
      if (url.includes('/api/ExecGroupMembers')) {
        return Promise.resolve(jsonResponse({ Results: [`Successfully completed ${cippAction}`] }));
      }
      throw new Error(`unexpected fetch: ${url} ${init.method}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = (await service.modifyDistributionGroupMember(
      'contoso.com',
      groupId,
      'alice@contoso.com',
      action
    )) as { status: string };

    expect(result.status).toBe('modified');
    const [lookupUrl] = fetchMock.mock.calls[0];
    expect(new URL(lookupUrl).searchParams.get('groupID')).toBe(groupId);
    const [userLookupUrl] = fetchMock.mock.calls[1];
    expect(new URL(userLookupUrl).searchParams.get('graphFilter')).toBe(
      "userPrincipalName eq 'alice@contoso.com'"
    );
    const [, writeInit] = fetchMock.mock.calls[2];
    expect(JSON.parse(writeInit.body as string)).toEqual({
      action: cippAction,
      groupId,
      tenantFilter: 'contoso.com',
      users: ['Alice@contoso.com'],
    });
  });

  it.each([
    ['Microsoft 365', { groupType: 'Microsoft 365', groupTypes: ['Unified'] }],
    ['security group', { groupType: 'Security', mailEnabled: false, securityEnabled: true }],
    ['mail-enabled security group', { groupType: 'Mail-Enabled Security', securityEnabled: true }],
    ['on-premises distribution list', { onPremisesSyncEnabled: true }],
  ])('refuses a %s without sending a write', async (_label, override) => {
    const fetchMock = jest.fn(async () => jsonResponse(distributionList(override)));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.modifyDistributionGroupMember(
        'contoso.com',
        groupId,
        'alice@contoso.com',
        'add'
      )
    ).rejects.toBeInstanceOf(McpError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['allTenants', groupId, 'alice@contoso.com'],
    ['contoso.com', 'not-a-guid', 'alice@contoso.com'],
    ['contoso.com', groupId, 'not-a-upn'],
  ])('rejects an unsafe target before any request', async (tenant, id, member) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.modifyDistributionGroupMember(tenant, id, member, 'add')
    ).rejects.toBeInstanceOf(McpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not report success when CIPP returns failure text in HTTP 200', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>((url) => {
      if (url.includes('/api/ListGroups')) return Promise.resolve(jsonResponse(distributionList()));
      if (url.includes('/api/ListUsers')) {
        return Promise.resolve(
          jsonResponse([{ id: '22222222-2222-4222-8222-222222222222', userPrincipalName: 'alice@contoso.com' }])
        );
      }
      return Promise.resolve(jsonResponse({ Results: 'Failed to add user because Exchange rejected it' }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = (await service.modifyDistributionGroupMember(
      'contoso.com',
      groupId,
      'alice@contoso.com',
      'add'
    )) as { status: string; failures: string[] };

    expect(result.status).toBe('failed');
    expect(result.failures).toHaveLength(1);
  });

  it('refuses an email-shaped non-user before sending a write', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>((url) => {
      if (url.includes('/api/ListGroups')) return Promise.resolve(jsonResponse(distributionList()));
      if (url.includes('/api/ListUsers')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ Results: 'unexpected write' }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.modifyDistributionGroupMember(
        'contoso.com',
        groupId,
        'another-group@contoso.com',
        'add'
      )
    ).rejects.toBeInstanceOf(McpError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/api/ExecGroupMembers'))).toBe(false);
  });
});
