/**
 * HTTP CollectorService factory (#551): domain ports over HTTP+WS host transport.
 */

import type { CollectorService } from "@collector/api";
import { createCollectorHostService } from "./host-collector-client.js";
import {
  createHttpHostTransport,
  type CollectorHostTransport,
  type HttpHostTransportOptions,
} from "./http-host-transport.js";
import type { CollectorHostClientOptions } from "./host-client-types.js";

export type CreateHttpCollectorServiceOptions = CollectorHostClientOptions &
  Omit<HttpHostTransportOptions, "baseUrl" | "token"> & {
    /** Reuse an already-dialed transport (avoids a second dial for UI ports). */
    transport?: CollectorHostTransport;
  };

/**
 * Dial the domain host over HTTP RPC + WS events and return service + transport.
 */
export async function createHttpCollectorServiceDial(
  baseUrl: string,
  token: string,
  options: CreateHttpCollectorServiceOptions = {},
): Promise<{ service: CollectorService; transport: CollectorHostTransport }> {
  const { snapshot, thumbnails, transport: existing, ...transportOptions } =
    options;
  const transport =
    existing ??
    (await createHttpHostTransport({
      baseUrl,
      token,
      ...transportOptions,
    }));
  return {
    transport,
    service: createCollectorHostService(transport, { snapshot, thumbnails }),
  };
}

/**
 * Dial the domain host over HTTP RPC + WS events and return CollectorService ports.
 */
export async function createHttpCollectorService(
  baseUrl: string,
  token: string,
  options: CreateHttpCollectorServiceOptions = {},
): Promise<CollectorService> {
  const { service } = await createHttpCollectorServiceDial(
    baseUrl,
    token,
    options,
  );
  return service;
}

export {
  createHttpHostTransport,
  deriveWsEventsUrl,
  type CollectorHostTransport,
  type HttpHostTransportOptions,
} from "./http-host-transport.js";
