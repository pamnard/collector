import type { DashboardSnapshotPort } from "@collector/api";
import { createDashboardSnapshotService } from "@collector/service";
import type { HostWireClient } from "@collector/service/wire";
import { createCollectorHostDashboardSnapshotPort } from "./host-collector-client.js";
import { createNodeFileSystemAdapter } from "./node-fs-adapter.js";

const nodeSnapshotByTransport = new WeakMap<
  HostWireClient,
  Promise<DashboardSnapshotPort>
>();

const pureSnapshot = createCollectorHostDashboardSnapshotPort();

export function createNodeSnapshotPort(
  transport: HostWireClient,
): DashboardSnapshotPort {
  const getService = (): Promise<DashboardSnapshotPort> => {
    let pending = nodeSnapshotByTransport.get(transport);
    if (!pending) {
      pending = (async () => {
        const fs = createNodeFileSystemAdapter();
        let configDir = "";
        return createDashboardSnapshotService({
          fs,
          ensureConfigDir: async () => {
            if (!configDir) {
              configDir = (await transport.request(
                "getAppConfigDirectory",
              )) as string;
            }
            return configDir;
          },
          isDevMock: () => false,
          readDevMockSnapshot: () => null,
          writeDevMockSnapshot: () => {},
        });
      })();
      nodeSnapshotByTransport.set(transport, pending);
    }
    return pending;
  };

  let syncService: DashboardSnapshotPort | null = null;

  return {
    async ensureDashboardSnapshot() {
      syncService = await getService();
      return syncService.ensureDashboardSnapshot();
    },
    peekMatchingDashboardSnapshot(input) {
      return syncService?.peekMatchingDashboardSnapshot(input) ?? null;
    },
    async persistDashboardSnapshot(snapshot) {
      syncService = await getService();
      return syncService.persistDashboardSnapshot(snapshot);
    },
    async clearDashboardSnapshot() {
      syncService = await getService();
      return syncService.clearDashboardSnapshot();
    },
    buildDashboardSnapshot(input) {
      return (syncService ?? pureSnapshot).buildDashboardSnapshot(input);
    },
  };
}
