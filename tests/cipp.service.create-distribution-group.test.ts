import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';
import { bodyOf, jsonResponse } from './helpers.js';

const logger = new Logger('error');

describe('CippService createDistributionGroup', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the CIPP classic distribution-group contract', async () => {
    const service = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger
    );
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse({ Results: 'Successfully created group' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await service.createDistributionGroup('contoso.com', {
      displayName: 'Finance Team',
      description: 'Finance distribution list',
      primaryEmailAddress: 'finance@contoso.com',
      allowExternal: true,
      owners: ['owner@contoso.com'],
      members: ['member@contoso.com'],
    });

    expect(bodyOf(fetchMock, '/api/AddGroup')).toEqual({
      tenantFilter: 'contoso.com',
      displayName: 'Finance Team',
      description: 'Finance distribution list',
      groupType: 'Distribution',
      username: 'finance@contoso.com',
      primaryEmailAddress: 'finance@contoso.com',
      allowExternal: true,
      owners: ['owner@contoso.com'],
      members: ['member@contoso.com'],
    });
  });

  it.each([
    ['allTenants', 'finance@contoso.com'],
    ['contoso.com', 'not-an-email'],
  ])('rejects unsafe input before any request', async (tenant, address) => {
    const service = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger
    );
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.createDistributionGroup(tenant, {
        displayName: 'Finance Team',
        primaryEmailAddress: address,
      })
    ).rejects.toBeInstanceOf(McpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
