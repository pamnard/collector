/**
 * Long-lived MCP host session (#826).
 *
 * With --data-dir only (no pinned token), one auth_failed re-reads published
 * base-url/token files and retries — host remints the token on each start.
 */

import {
  createCollectorHostServiceClient,
  createHttpHostTransport,
  type CollectorHostServiceClient,
} from "@collector/client";
import {
  defaultServiceHostTokenPath,
  isHostWireError,
  SERVICE_HOST_TOKEN_ENV,
} from "@collector/service/host";
import {
  type McpHostEndpoint,
  type ParsedMcpEndpointArgs,
  resolveMcpHostEndpoint,
} from "./endpoint.js";

const CONNECT_TIMEOUT_MS = 2_000;

export type McpHostSession = {
  getClient(): CollectorHostServiceClient;
  canRefreshFromDataDir: boolean;
  endpointArgs: ParsedMcpEndpointArgs;
  getEndpoint(): McpHostEndpoint;
  refreshFromDataDir(): Promise<void>;
  withAuthRetry<T>(
    fn: (client: CollectorHostServiceClient) => Promise<T>,
  ): Promise<T>;
};

export function isAuthFailedError(error: unknown): boolean {
  return isHostWireError(error) && error.code === "auth_failed";
}

/** Loud tool-facing message after auth still fails (optionally post-refresh). */
export function formatMcpAuthFailure(
  error: unknown,
  session: Pick<
    McpHostSession,
    "canRefreshFromDataDir" | "endpointArgs" | "getEndpoint"
  >,
): string {
  const base = error instanceof Error ? error.message : String(error);
  const layerCode = isHostWireError(error)
    ? ` [${error.layer}/${error.code}]`
    : "";
  const dataDir = session.endpointArgs.dataDir?.trim();
  if (session.canRefreshFromDataDir && dataDir) {
    const tokenPath = defaultServiceHostTokenPath(dataDir);
    return (
      `${base}${layerCode}. ` +
      `Re-read host credentials from data-dir still failed ` +
      `(${tokenPath}; last baseUrl ${session.getEndpoint().baseUrl}). ` +
      `Confirm the domain host is running and wrote a fresh token file.`
    );
  }
  if (session.endpointArgs.token !== undefined) {
    return (
      `${base}${layerCode}. ` +
      `Pinned --token / ${SERVICE_HOST_TOKEN_ENV} was used; ` +
      `MCP does not re-read the data-dir token file. ` +
      `Pass a current token or use --data-dir only.`
    );
  }
  return `${base}${layerCode}`;
}

async function dialClient(
  endpoint: McpHostEndpoint,
): Promise<CollectorHostServiceClient> {
  const httpTransport = await createHttpHostTransport({
    baseUrl: endpoint.baseUrl,
    token: endpoint.token,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    enableEvents: false,
  });
  return createCollectorHostServiceClient(httpTransport);
}

/** Session that never refreshes (tests / pinned static client). */
export function createStaticMcpHostSession(
  client: CollectorHostServiceClient,
  endpoint: McpHostEndpoint = {
    baseUrl: "http://127.0.0.1:0",
    token: "static",
  },
): McpHostSession {
  const endpointArgs: ParsedMcpEndpointArgs = {
    baseUrl: endpoint.baseUrl,
    token: endpoint.token,
    ...(endpoint.dataDir === undefined ? {} : { dataDir: endpoint.dataDir }),
  };
  return {
    getClient: () => client,
    canRefreshFromDataDir: false,
    endpointArgs,
    getEndpoint: () => endpoint,
    refreshFromDataDir: async () => {
      throw new Error("MCP host session cannot refresh: credentials are pinned");
    },
    withAuthRetry: async (fn) => fn(client),
  };
}

/** Live session: dial once, optionally refresh from data-dir on auth_failed. */
export async function createMcpHostSession(
  endpointArgs: ParsedMcpEndpointArgs,
): Promise<McpHostSession> {
  const canRefreshFromDataDir =
    endpointArgs.token === undefined &&
    endpointArgs.dataDir !== undefined &&
    endpointArgs.dataDir.trim() !== "";

  let endpoint = await resolveMcpHostEndpoint(endpointArgs);
  let client = await dialClient(endpoint);

  const session: McpHostSession = {
    getClient: () => client,
    canRefreshFromDataDir,
    endpointArgs,
    getEndpoint: () => endpoint,
    refreshFromDataDir: async () => {
      if (!canRefreshFromDataDir) {
        throw new Error(
          "MCP host session cannot refresh: credentials are pinned (--token / env)",
        );
      }
      const nextEndpoint = await resolveMcpHostEndpoint(endpointArgs);
      const nextClient = await dialClient(nextEndpoint);
      const previous = client;
      client = nextClient;
      endpoint = nextEndpoint;
      await previous.close();
    },
    withAuthRetry: async (fn) => {
      try {
        return await fn(client);
      } catch (error) {
        if (!isAuthFailedError(error) || !canRefreshFromDataDir) {
          throw error;
        }
        await session.refreshFromDataDir();
        return await fn(client);
      }
    },
  };

  return session;
}
