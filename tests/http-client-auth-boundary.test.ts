import { createHash } from 'node:crypto';
import { CippMcpServer } from '../src/mcp/server.js';
import { Logger } from '../src/utils/logger.js';
import type { EnvironmentConfig } from '../src/utils/config.js';

const HOST = '127.0.0.1';
const PORT = 47532;
const TOKEN = 'boundary-test-token-that-is-long-and-random-enough';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function post(authorization?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (authorization) headers.Authorization = authorization;

  return fetch(`http://${HOST}:${PORT}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'auth-boundary-test', version: '1.0.0' },
      },
      id: 1,
    }),
  });
}

describe('HTTP MCP bearer authentication boundary', () => {
  let server: CippMcpServer;

  beforeAll(async () => {
    const logger = new Logger('error', 'simple');
    const envConfig: EnvironmentConfig = {
      cipp: { baseUrl: 'https://cipp.invalid.test', apiKey: 'fake-cipp-key' },
      server: { name: 'cipp-auth-test', version: '1.0.0' },
      transport: { type: 'http', host: HOST, port: PORT },
      logging: { level: 'error', format: 'simple' },
      cache: { readTtlMs: 300000 },
      auth: {
        mode: 'env',
        httpClientMode: 'bearer',
        httpClientTokenHashes: [
          { callerId: 'jeff', hash: Buffer.from(sha256(TOKEN), 'hex') },
        ],
        trustProxy: false,
      },
      security: { enabledTools: ['cipp_ping'] },
    };
    server = new CippMcpServer(
      { name: 'cipp-auth-test', version: '1.0.0', cipp: envConfig.cipp },
      logger,
      envConfig
    );
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('rejects missing and invalid bearer credentials before MCP handling', async () => {
    const missing = await post();
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="cipp-mcp"');

    const invalid = await post('Bearer wrong-token');
    expect(invalid.status).toBe(401);
  });

  it('allows a valid bearer credential to initialize MCP', async () => {
    const response = await post(`Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe('cipp-auth-test');
  });
});
