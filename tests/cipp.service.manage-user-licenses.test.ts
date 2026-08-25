import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';
import { bodyOf, jsonResponse } from './helpers.js';

const logger = new Logger('error');
const userId = '11111111-1111-1111-1111-111111111111';
const skuA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const skuB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const skuC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeService(): CippService {
  return new CippService(
    { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
    logger
  );
}

describe('CippService manageUserLicenses', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves unmentioned licenses while adding and removing selected SKUs', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>((url) => {
      if (url.includes('/api/ListUsers')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: userId,
              userPrincipalName: 'alice@contoso.com',
              assignedLicenses: [{ skuId: skuA }, { skuId: skuB }],
            },
          ])
        );
      }
      if (url.includes('/api/EditUser')) {
        return Promise.resolve(jsonResponse({ Results: 'Success. The user has been edited.' }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeService().manageUserLicenses('contoso.com', userId, {
      addLicenseSkuIds: [skuC],
      removeLicenseSkuIds: [skuA],
    });

    expect(bodyOf(fetchMock, '/api/EditUser')).toEqual({
      tenantFilter: 'contoso.com',
      id: userId,
      username: 'alice',
      Domain: 'contoso.com',
      licenses: [{ value: skuB }, { value: skuC }],
      removeLicenses: false,
    });
  });

  it('uses CIPP removeLicenses only when the resulting set is empty', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>((url) => {
      if (url.includes('/api/ListUsers')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: userId,
              userPrincipalName: 'alice@contoso.com',
              assignedLicenses: [{ skuId: skuA }],
            },
          ])
        );
      }
      return Promise.resolve(jsonResponse({ Results: 'Success. The user has been edited.' }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeService().manageUserLicenses('contoso.com', userId, {
      removeLicenseSkuIds: [skuA],
    });

    const body = bodyOf(fetchMock, '/api/EditUser');
    expect(body.removeLicenses).toBe(true);
    expect(body.licenses).toBeUndefined();
  });

  it('rejects an add/remove overlap before looking up the user', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      makeService().manageUserLicenses('contoso.com', userId, {
        addLicenseSkuIds: [skuA],
        removeLicenseSkuIds: [skuA],
      })
    ).rejects.toBeInstanceOf(McpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
