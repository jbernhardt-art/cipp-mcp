import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';
import { bodyOf, jsonResponse } from './helpers.js';

const logger = new Logger('error');

describe('CippService createUser', () => {
  let service: CippService;

  beforeEach(() => {
    service = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('maps a full UPN to the AddUser contract and preserves CIPP generated credentials', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(
        jsonResponse({
          Results: ['Successfully added Alice Example'],
          copyField: 'https://pwpush.example/p/abc123',
        })
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = (await service.createUser('contoso.com', {
      displayName: 'Alice Example',
      userPrincipalName: 'alice@contoso.com',
      usageLocation: 'US',
    })) as { status: string; cippResponse: { copyField: string } };

    expect(bodyOf(fetchMock, '/api/AddUser')).toEqual({
      tenantFilter: 'contoso.com',
      username: 'alice',
      Domain: 'contoso.com',
      displayName: 'Alice Example',
      MustChangePass: true,
      usageLocation: 'US',
    });
    expect(result.status).toBe('created');
    expect(result.cippResponse.copyField).toBe('https://pwpush.example/p/abc123');
  });

  it('passes an explicit password only when one was supplied', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse({ Results: 'Successfully added Alice Example' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await service.createUser('contoso.com', {
      displayName: 'Alice Example',
      userPrincipalName: 'alice@contoso.com',
      password: 'Temporary value for contract testing',
      mustChangePasswordNextSignIn: false,
    });

    const body = bodyOf(fetchMock, '/api/AddUser');
    expect(body.password).toBe('Temporary value for contract testing');
    expect(body.MustChangePass).toBe(false);
  });

  it.each(['allTenants', ''])('rejects unsafe tenant target %p before sending a request', async (tenant) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.createUser(tenant, {
        displayName: 'Alice Example',
        userPrincipalName: 'alice@contoso.com',
      })
    ).rejects.toBeInstanceOf(McpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
