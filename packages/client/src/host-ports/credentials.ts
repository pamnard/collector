import type { CredentialsPort } from "@collector/api";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcCredentialsPort(ctx: IpcSessionCtx): CredentialsPort {
  const { transport } = ctx;
  return {
    setCredential: async (input) => {
      await transport.request("setCredential", input);
    },
    getCredential: async (input) =>
      transport.request("getCredential", input) as Promise<string | null>,
    hasCredential: async (input) =>
      transport.request("hasCredential", input) as Promise<boolean>,
    deleteCredential: async (input) => {
      await transport.request("deleteCredential", input);
    },
    getCredentialsAvailability: async () =>
      transport.request("getCredentialsAvailability") as Promise<{
        available: boolean;
        reason?: string;
      }>,
  };
}
