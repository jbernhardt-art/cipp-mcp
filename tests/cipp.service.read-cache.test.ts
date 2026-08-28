import { CippService } from '../src/services/cipp.service.js';
import { Logger } from '../src/utils/logger.js';
import { jsonResponse } from './helpers.js';

const logger = new Logger('error');

describe('CippService read cache', () => {
  let svc: CippService;
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

  beforeEach(() => {
    svc = new CippService(
      { cipp: { baseUrl: 'https://cipp.example', apiKey: 'test-key' } },
      logger,
      { readCacheTtlMs: 300000 }
    );
    fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse([{ id: 'user-1' }]))
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reuses an identical successful user-list read during the TTL', async () => {
    const first = await svc.listUsers('contoso.com');
    const second = await svc.listUsers('CONTOSO.COM');

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces identical user-list requests already in progress', async () => {
    let resolveFetch!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
    );

    const first = svc.listUsers('contoso.com');
    const second = svc.listUsers('contoso.com');
    resolveFetch(jsonResponse([{ id: 'user-1' }]));

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: 'user-1' }],
      [{ id: 'user-1' }],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct filters in separate cache entries', async () => {
    await svc.listUsers('contoso.com');
    await svc.listUsers('contoso.com', {
      searchField: 'userPrincipalName',
      searchValue: 'alice@contoso.com',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached tenant and user reads before a write', async () => {
    await svc.listUsers('contoso.com');
    await svc.createUser('contoso.com', {
      displayName: 'Alice Example',
      userPrincipalName: 'alice@contoso.com',
    });
    await svc.listUsers('contoso.com');

    const listUserCalls = fetchMock.mock.calls.filter(([url]) => url.includes('/api/ListUsers'));
    expect(listUserCalls).toHaveLength(2);
  });

  it('does not reuse or cache a pre-write read that was still in progress', async () => {
    let resolveOldRead!: (response: Response) => void;
    let listUserCalls = 0;
    fetchMock.mockImplementation((url) => {
      if (url.includes('/api/ListUsers')) {
        listUserCalls += 1;
        if (listUserCalls === 1) {
          return new Promise<Response>((resolve) => { resolveOldRead = resolve; });
        }
        return Promise.resolve(jsonResponse([{ id: 'fresh-user' }]));
      }
      return Promise.resolve(jsonResponse({ Results: 'created' }));
    });

    const oldRead = svc.listUsers<Array<{ id: string }>>('contoso.com');
    await Promise.resolve();
    await svc.createUser('contoso.com', {
      displayName: 'Alice Example',
      userPrincipalName: 'alice@contoso.com',
    });
    const freshRead = svc.listUsers<Array<{ id: string }>>('contoso.com');
    resolveOldRead(jsonResponse([{ id: 'stale-user' }]));

    await expect(oldRead).resolves.toEqual([{ id: 'stale-user' }]);
    await expect(freshRead).resolves.toEqual([{ id: 'fresh-user' }]);
    expect(listUserCalls).toBe(2);

    await svc.listUsers('contoso.com');
    expect(listUserCalls).toBe(2);
  });
});
