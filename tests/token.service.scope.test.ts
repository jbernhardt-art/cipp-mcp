import { TokenProvider } from '../src/services/token.service.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('error');

describe('TokenProvider CIPP API scope', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to the api:// client application scope required by CIPP', async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('scope')).toBe('api://client-id/.default');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new TokenProvider(
      {
        tenantId: 'tenant-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      logger
    );

    await expect(provider.getAccessToken()).resolves.toBe('test-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
