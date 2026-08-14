/**
 * Resolve domain-host HTTP endpoint for CLI (#550 G).
 *
 * baseUrl from --base-url / COLLECTOR_SERVICE_BASE_URL / data-dir baseUrl file.
 * Token from --token / COLLECTOR_HOST_TOKEN or the host token file under --data-dir.
 */

import {
  defaultServiceHostTokenPath,
  resolveServiceHostBaseUrl,
  resolveServiceHostToken,
  SERVICE_HOST_TOKEN_ENV,
} from "@collector/service/host";
import { CliUsageError } from "./types.js";

export type ParsedCliEndpointArgs = {
  baseUrl?: string;
  dataDir?: string;
  token?: string;
};

export type CliHostEndpoint = {
  baseUrl: string;
  token: string;
  dataDir?: string;
};

/**
 * Resolve baseUrl + host token for dialing the living domain host.
 */
export async function resolveCliHostEndpoint(
  options: ParsedCliEndpointArgs,
): Promise<CliHostEndpoint> {
  let baseUrl: string;
  try {
    baseUrl = await resolveServiceHostBaseUrl({
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(message);
  }

  if (options.token !== undefined && options.token.trim() !== "") {
    return {
      baseUrl,
      token: options.token.trim(),
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    };
  }

  if (options.dataDir === undefined || options.dataDir.trim() === "") {
    throw new CliUsageError(
      `Host token required: --token / ${SERVICE_HOST_TOKEN_ENV} or --data-dir / COLLECTOR_DATA_DIR (token file)`,
    );
  }

  const dataDir = options.dataDir.trim();
  try {
    const token = await resolveServiceHostToken({
      dataDir,
      ...(options.token === undefined ? {} : { token: options.token }),
    });
    return { baseUrl, token, dataDir };
  } catch (error) {
    const tokenPath = defaultServiceHostTokenPath(dataDir);
    const message = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(
      `Host token file missing or unreadable (${tokenPath}): ${message}`,
    );
  }
}
