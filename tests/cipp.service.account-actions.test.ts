import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';
import { bodyOf, jsonResponse } from './helpers.js';

const logger = new Logger('error');
const userId = '11111111-1111-1111-1111-111111111111';

describe('CippService account action payloads', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['disableUser', 'ExecDisableUser'],
    ['resetMFA', 'ExecResetMFA'],
    ['revokeSessions', 'ExecRevokeSessions'],
  ] as const)('maps %s to the expected CIPP endpoint and identifier', async (method, endpoint) => {
    const service = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger
    );
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse({ Results: 'Success' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await service[method]('contoso.com', userId);

    expect(bodyOf(fetchMock, `/api/${endpoint}`)).toEqual({
      tenantFilter: 'contoso.com',
      ID: userId,
    });
  });
});
