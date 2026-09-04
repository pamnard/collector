/**
 * DNS stub for offline extract tests — fixture CDN hosts do not resolve.
 * Always pair with an injected fetchImpl; production uses real dns.lookup.
 */

import type { LookupHostAddresses } from "../fetch-remote-bytes.js";

export const OFFLINE_PUBLIC_LOOKUP: LookupHostAddresses = async () => [
  "93.184.216.34",
];
