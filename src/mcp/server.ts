// CIPP MCP Server
// Handles the Model Context Protocol server setup and integration with CIPP.
// Supports both local (env-based) and gateway (header-based) credential modes.

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CippService } from '../services/cipp.service.js';
import { Logger } from '../utils/logger.js';
import { McpServerConfig } from '../types/index.js';
import { EnvironmentConfig, parseCredentialsFromHeaders } from '../utils/config.js';
import { CippToolHandler } from '../handlers/tool.handler.js';
import { verifyS2sHeader, S2S_HEADER } from '../s2s-verify.js';
import { authenticateHttpBearer } from '../http-client-auth.js';
import { buildToolAuditContext } from '../audit-context.js';

// Conduit service-to-service auth (gateway#377 parity). Non-empty =
// enforce X-Gateway-S2S on every /mcp request; empty = disabled, behavior
// exactly as before (dark-by-default until the gateway provisions this
// container's derived subkey). See src/s2s-verify.ts.
const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || '';

export const CIPP_MCP_INSTRUCTIONS = `
Use only this server's exposed CIPP MCP tools for CIPP tenant operations. Never use shell commands, curl, PowerShell, Node.js, or raw HTTP as a fallback to invoke CIPP, invoke this server, or inspect credentials. If a required MCP tool is unavailable or the connection fails, stop and report the limitation instead of bypassing the MCP.

CIPP MCP Server - M365 multi-tenant management platform for MSPs.

Use tenantFilter to scope operations to a specific tenant domain (e.g. "contoso.com").
Most listing tools accept 'allTenants' as tenantFilter to query across every managed tenant.
Cold CIPP reads can take up to a minute. Wait for the result and never repeat a read that returned successfully.
Tenant and user-list reads are cached briefly and identical in-flight reads are combined.
For a known complete UPN or email address, call cipp_list_users directly with an exact searchField and searchValue. Do not list tenants first.
For tenant-wide user questions, use cipp_list_users filters and request only the fields needed. Compact mode is the default. Use full mode only when raw CIPP/Graph objects are necessary because it can return megabytes of data.

Always confirm destructive operations (disable user, offboard user, reset password) before executing.

Tool categories:
- Tenants: list and inspect managed tenants
- Users: list, create, edit, disable, offboard, MFA/session management, BEC check
- Groups: list and create Azure AD groups
- Mailboxes: list mailboxes and permissions, configure OoO and forwarding
- Security: Conditional Access policies, named locations
- Standards: compliance standards, BPA results, domain health
- Licenses: per-tenant and CSP-level license reporting
- Alerts: audit logs and alert queue
- GDAP: roles and relationship invites
- Scheduler: list and create scheduled tasks
- Core: ping, version, logs
`.trim();

export class CippMcpServer {
  private server: Server;
  private config: McpServerConfig;
  private cippService: CippService;
  private toolHandler: CippToolHandler;
  private logger: Logger;
  private envConfig: EnvironmentConfig | undefined;
  private httpServer?: HttpServer;

  constructor(config: McpServerConfig, logger: Logger, envConfig?: EnvironmentConfig) {
    this.logger = logger;
    this.config = config;
    this.envConfig = envConfig;

    this.cippService = new CippService(config, logger, {
      readCacheTtlMs: envConfig?.cache.readTtlMs,
    });
    this.toolHandler = new CippToolHandler(
      this.cippService,
      logger,
      envConfig?.security.enabledTools
    );

    this.server = this.createFreshServer();
  }

  /**
   * Create a fresh MCP Server with all handlers registered.
   * Called per-request in HTTP (stateless) mode so each initialise gets a clean server.
   */
  private createFreshServer(): Server {
    const server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
        instructions: this.getServerInstructions(),
      }
    );

    server.onerror = (error) => {
      this.logger.error('MCP Server error:', error);
    };

    server.oninitialized = () => {
      this.logger.info('MCP Server initialized and ready to serve requests');
    };

    this.setupHandlers(server);
    this.toolHandler.setServer(server);

    return server;
  }

  /**
   * Returns instructions that help MCP clients understand how to use this server.
   */
  private getServerInstructions(): string {
    return CIPP_MCP_INSTRUCTIONS;
  }

  /**
   * Register all MCP request handlers on the given server instance.
   */
  private setupHandlers(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug('Handling list tools request');
      return { tools: this.toolHandler.getToolDefinitions() };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      this.logger.debug(`Handling tool call: ${request.params.name}`);
      try {
        const result = await this.toolHandler.handleToolCall(
          request.params.name,
          (request.params.arguments as Record<string, unknown>) || {}
        );
        return {
          content: result.content,
          isError: result.isError,
        };
      } catch (error) {
        this.logger.error(`Failed to call tool ${request.params.name}:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    });

  }

  /**
   * Start the server using the configured transport type.
   */
  async start(): Promise<void> {
    const transportType = this.envConfig?.transport?.type || 'stdio';
    this.logger.info(`Starting CIPP MCP Server with ${transportType} transport...`);

    if (transportType === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }
  }

  private async startStdioTransport(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('CIPP MCP Server started on stdio transport');
  }

  private async startHttpTransport(): Promise<void> {
    const port = this.envConfig?.transport?.port || 8080;
    const host = this.envConfig?.transport?.host || '0.0.0.0';
    const isGatewayMode = this.envConfig?.auth?.mode === 'gateway';
    const httpClientAuthMode = this.envConfig?.auth?.httpClientMode || 'none';
    const httpClientTokenHashes = this.envConfig?.auth?.httpClientTokenHashes || [];
    const trustProxy = this.envConfig?.auth?.trustProxy || false;

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url.pathname === '/mcp') {
        // Conduit service-to-service auth (gateway#377 parity): rejected
        // BEFORE any credential extraction (OAuth or static key), mirroring
        // every other ported wrapper (e.g.
        // containers/sentinelone-mcp/gateway_wrapper.py).
        if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
            })
          );
          return;
        }

        let callerId = 'unauthenticated';
        if (httpClientAuthMode === 'bearer') {
          const identity = authenticateHttpBearer(
            req.headers.authorization,
            httpClientTokenHashes
          );
          if (!identity) {
            this.logger.warn('MCP client authentication rejected', {
              event: 'mcp_auth_rejected',
              remoteAddress: this.getRemoteAddress(req, trustProxy),
            });
            res.writeHead(401, {
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer realm="cipp-mcp"',
            });
            res.end(JSON.stringify({ error: 'Missing or invalid bearer token' }));
            return;
          }
          callerId = identity.callerId;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Method not allowed' },
              id: null,
            })
          );
          return;
        }

        let toolHandler = this.toolHandler;
        let cippService = this.cippService;

        if (isGatewayMode) {
          const credentials = parseCredentialsFromHeaders(
            req.headers as Record<string, string | string[] | undefined>
          );

          const hasOAuth =
            !!credentials.tenantId && !!credentials.clientId && !!credentials.clientSecret;
          const hasStatic = !!credentials.apiKey;

          if (!credentials.baseUrl || (!hasStatic && !hasOAuth)) {
            this.logger.warn('Gateway mode: Missing required credentials in request headers', {
              hasBaseUrl: !!credentials.baseUrl,
              hasApiKey: hasStatic,
              hasOAuthCreds: hasOAuth,
            });
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Missing credentials',
                message:
                  'Gateway mode requires x-base-url plus either x-api-key or (x-tenant-id + x-client-id + x-client-secret)',
                required: ['x-base-url', 'x-api-key OR (x-tenant-id + x-client-id + x-client-secret)'],
              })
            );
            return;
          }

          const requestConfig: McpServerConfig = {
            name: this.config.name,
            version: this.config.version,
            cipp: {
              baseUrl: credentials.baseUrl,
              ...(credentials.apiKey !== undefined ? { apiKey: credentials.apiKey } : {}),
              ...(credentials.tenantId !== undefined ? { tenantId: credentials.tenantId } : {}),
              ...(credentials.clientId !== undefined ? { clientId: credentials.clientId } : {}),
              ...(credentials.clientSecret !== undefined ? { clientSecret: credentials.clientSecret } : {}),
              ...(credentials.tokenScope !== undefined ? { tokenScope: credentials.tokenScope } : {}),
              ...(credentials.tokenUrl !== undefined ? { tokenUrl: credentials.tokenUrl } : {}),
            },
          };

          cippService = new CippService(requestConfig, this.logger, {
            readCacheTtlMs: this.envConfig?.cache.readTtlMs,
          });
          toolHandler = new CippToolHandler(
            cippService,
            this.logger,
            this.envConfig?.security.enabledTools
          );
        }

        const server = new Server(
          { name: this.config.name, version: this.config.version },
          {
            capabilities: { tools: { listChanged: true } },
            instructions: this.getServerInstructions(),
          }
        );

        server.onerror = (error) => this.logger.error('MCP request server error:', error);

        // Wire up handlers using the (possibly per-request) toolHandler
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: toolHandler.getToolDefinitions(),
        }));

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const requestId = randomUUID();
          const startedAt = Date.now();
          const toolArgs = (request.params.arguments as Record<string, unknown>) || {};
          const auditContext = buildToolAuditContext(request.params.name, toolArgs);
          const remoteAddress = this.getRemoteAddress(req, trustProxy);
          this.logger.info('MCP tool call started', {
            event: 'mcp_tool_call_started',
            requestId,
            callerId,
            tool: request.params.name,
            remoteAddress,
            ...auditContext,
          });
          try {
            const result = await toolHandler.handleToolCall(
              request.params.name,
              toolArgs
            );
            this.logger.info('MCP tool call completed', {
              event: 'mcp_tool_call_completed',
              requestId,
              callerId,
              tool: request.params.name,
              outcome: result.isError ? 'tool_error' : 'success',
              durationMs: Date.now() - startedAt,
              remoteAddress,
              ...auditContext,
            });
            return { content: result.content, isError: result.isError };
          } catch (error) {
            this.logger.error('MCP tool call failed', {
              event: 'mcp_tool_call_failed',
              requestId,
              callerId,
              tool: request.params.name,
              outcome: 'exception',
              durationMs: Date.now() - startedAt,
              errorType: error instanceof Error ? error.name : 'UnknownError',
              remoteAddress,
              ...auditContext,
            });
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
              content: [{ type: 'text', text: message }],
              isError: true,
            };
          }
        });

        toolHandler.setServer(server);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        res.on('close', () => {
          transport.close();
          server.close();
        });

        server
          .connect(transport as any)
          .then(() => {
            transport.handleRequest(req, res);
          })
          .catch((err) => {
            this.logger.error('MCP transport connect error:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  error: { code: -32603, message: 'Internal error' },
                  id: null,
                })
              );
            }
          });

        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, host, () => {
        this.logger.info(`CIPP MCP Server listening on http://${host}:${port}/mcp`);
        this.logger.info(`Health check available at http://${host}:${port}/health`);
        this.logger.info(
          `Authentication mode: ${isGatewayMode ? 'gateway (header-based)' : 'env (environment variables)'}`
        );
        this.logger.info(
          `HTTP client authentication: ${httpClientAuthMode === 'bearer' ? `bearer (${httpClientTokenHashes.length} callers)` : 'none'}`
        );
        resolve();
      });
    });
  }

  private getRemoteAddress(req: IncomingMessage, trustProxy: boolean): string | undefined {
    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const first = value?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress;
  }

  /**
   * Gracefully stop the server.
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping CIPP MCP Server...');
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await this.server.close();
    this.logger.info('CIPP MCP Server stopped');
  }
}
