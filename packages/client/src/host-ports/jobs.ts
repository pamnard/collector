import type {
  JobPermanentFailure,
  JobStats,
  JobsPort,
  Subscription,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostJobsPort(ctx: HostSessionCtx): JobsPort {
  const { transport } = ctx;
  return {
    getJobStats(): Promise<JobStats> {
      return transport.request("getJobStats") as Promise<JobStats>;
    },
    subscribeJobPermanentFailure(
      onUpdate: (failure: JobPermanentFailure) => void,
    ): Subscription {
      const unsubEvent = transport.onEvent(
        SERVICE_HOST_EVENTS.jobPermanentFailure,
        (payload) => {
          onUpdate(payload as JobPermanentFailure);
        },
      );
      return subscriptionFromTeardown(unsubEvent);
    },
  };
}
