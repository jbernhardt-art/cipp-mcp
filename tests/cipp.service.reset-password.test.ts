import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';
import { bodyOf, jsonResponse } from './helpers.js';

const logger = new Logger('error');
const userId = '11111111-1111-1111-1111-111111111111';

describe('CippService resetPassword', () => {
  it('resolves the user and returns CIPP generated password output to the MCP caller', async () => {
    const service = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger
    );
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>((url) => {
      if (url.includes('/api/ListUsers')) {
        return Promise.resolve(
          jsonResponse([{ id: userId, userPrincipalName: 'alice@contoso.com' }])
        );
      }
      if (url.includes('/api/ExecResetPass')) {
        return Promise.resolve(
          jsonResponse({
            Results: 'Password reset completed',
            copyField: 'Generated-Password-Value',
          })
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = (await service.resetPassword('contoso.com', 'alice@contoso.com', true)) as {
      status: string;
      cippResponse: { copyField: string };
    };

    expect(bodyOf(fetchMock, '/api/ExecResetPass')).toEqual({
      tenantFilter: 'contoso.com',
      ID: userId,
      displayName: 'alice@contoso.com',
      MustChange: true,
    });
    expect(result.status).toBe('reset');
    expect(result.cippResponse.copyField).toBe('Generated-Password-Value');
    expect(bodyOf(fetchMock, '/api/ExecResetPass')).not.toHaveProperty('newPassword');
  });
});
