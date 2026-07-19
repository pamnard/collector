/**
 * @collector/service — in-process Collector service application module (#142).
 * #146: index boot/DB only. Domain slices land in later tickets.
 */

export {
  createCollectorIndexBoot,
  type ClosableSqlExecutor,
  type CollectorIndexBoot,
  type CollectorIndexBootDeps,
} from "./index-boot.js";
