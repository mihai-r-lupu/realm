// realm serve — starts the Realm MCP server over HTTP for hosted agent platforms.
// Requires REALM_SERVE_TOKEN env var for Bearer token auth, or --dev for local development.
import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Command } from 'commander';
import { JsonWorkflowStore } from '@sensigo/realm';
import { createRealmMcpServer } from '@sensigo/realm-mcp';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Checks an Authorization header's Bearer token using timing-safe comparison.
 * Returns true only if the header is present, has the Bearer scheme, and the
 * token matches byte-for-byte. Prevents timing side-channel attacks.
 */
export function checkBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
    if (!authHeader?.startsWith('Bearer ')) return false;
    const provided = authHeader.slice(7);
    const a = Buffer.from(provided);
    const b = Buffer.from(expectedToken);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export interface StartServerOptions {
    port: number;
    host: string;
    devMode: boolean;
    token: string | undefined;
    /** Custom workflow store — useful in tests to avoid writing to ~/.realm/. */
    workflowStore?: JsonWorkflowStore;
}

/**
 * Creates and starts the HTTP MCP server. Resolves once the server is listening.
 * The caller is responsible for calling server.close() when done.
 *
 * Each HTTP request gets a fresh MCP server + stateless transport. The MCP SDK's
 * Protocol.connect() does not allow reconnecting a server to a new transport, so
 * per-request isolation is the correct pattern for stateless HTTP mode.
 */
export async function startHttpMcpServer(options: StartServerOptions): Promise<Server> {
    const { port, host, devMode, token, workflowStore } = options;

    const httpServer = createServer(async (req, res) => {
        // Auth gate — evaluated before any MCP logic.
        if (!devMode) {
            if (!checkBearerToken(req.headers['authorization'], token!)) {
                res.writeHead(401, {
                    'WWW-Authenticate': 'Bearer',
                    'Content-Type': 'application/json',
                });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
        }

        // Collect the request body before handing off to the transport.
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(chunk as Buffer);
        }
        const rawBody = Buffer.concat(chunks).toString('utf-8');

        let parsedBody: unknown;
        if (rawBody.length > 0) {
            try {
                parsedBody = JSON.parse(rawBody);
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
                return;
            }
        }

        const store = workflowStore ?? new JsonWorkflowStore();
        const mcpServer = createRealmMcpServer({ workflowStore: store });
        // Omitting sessionIdGenerator enables stateless mode (SDK default when absent).
        // Cast through unknown because the SDK's StreamableHTTPServerTransport was not
        // compiled with exactOptionalPropertyTypes and its onclose getter returns
        // `(() => void) | undefined`, which TypeScript rejects against Transport's
        // `onclose?: () => void` under our stricter tsconfig.
        const transport = new StreamableHTTPServerTransport({}) as unknown as Transport;
        await mcpServer.connect(transport);
        await (transport as unknown as StreamableHTTPServerTransport).handleRequest(req, res, parsedBody);
    });

    return new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve(httpServer));
    });
}

/**
 * `realm serve` — starts the Realm MCP server over HTTP.
 * Designed for hosted agent platforms (OpenClaw, Claude.ai, custom backends) that
 * cannot spawn a local stdio subprocess.
 */
export const serveCommand = new Command('serve')
    .description('Start the Realm MCP server over HTTP (for hosted agent platforms that cannot use stdio)')
    .option('--port <number>', 'Port to listen on', '3001')
    .option('--host <address>', 'Bind address', '127.0.0.1')
    .option('--dev', 'Disable authentication (for local development only)')
    .action(async (options) => {
        const port = parseInt(options.port, 10);
        const host = options.host as string;
        const devMode = options.dev === true || process.env.REALM_DEV === '1';
        const token = process.env.REALM_SERVE_TOKEN;

        if (!devMode && !token) {
            console.error(
                'Error: REALM_SERVE_TOKEN is not set.\n' +
                'Set it to a secret token, or use --dev / REALM_DEV=1 for local development only.',
            );
            process.exit(1);
        }

        if (devMode) {
            console.warn(
                'Warning: Running in dev mode — authentication is disabled. ' +
                'Do not expose this to a network.',
            );
        }

        const httpServer = await startHttpMcpServer({ port, host, devMode, token });
        console.log(`Realm MCP server listening on http://${host}:${port}/`);
        if (!devMode) {
            console.log('Authentication: Bearer token (REALM_SERVE_TOKEN)');
        }

        // Graceful shutdown on SIGINT / SIGTERM.
        const shutdown = () => httpServer.close(() => process.exit(0));
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
