/**
 * HTTP CollectorService factory (#551): domain ports over HTTP+WS host transport.
 */

import type { CollectorService } from "@collector/api";
import { createCollectorHostService } from "./host-collector-client.js";
import {
  createHttpHostTransport,
  type HttpHostTransportOptions,
} from "./http-host-transport.js";
import type { CollectorHostClientOptions } from "./host-client-types.js";

export type CreateHttpCollectorServiceOptions = CollectorHostClientOptions &
  Omit<HttpHostTransportOptions, "baseUrl" | "token">;

/**
 * Dial the domain host over HTTP RPC + WS events and return CollectorService ports.
 */
export async function createHttpCollectorService(
  baseUrl: string,
  token: string,
  options: CreateHttpCollectorServiceOptions = {},
): Promise<CollectorService> {
  const { snapshot, thumbnails, ...transportOptions } = options;
  const transport = await createHttpHostTransport({
    baseUrl,
    token,
    ...transportOptions,
  });
  return createCollectorHostService(transport, { snapshot, thumbnails });
}

export {
  createHttpHostTransport,
  deriveWsEventsUrl,
  type CollectorHostTransport,
  type HttpHostTransportOptions,
} from "./http-host-transport.js";
