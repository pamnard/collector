export {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  applyInitialMigration,
  getInitialMigration,
  runMigrations,
  splitSqlMigration,
} from "./migrate.js";
export type { Migration, SqlExecutor, SqlMigrator, SqlReader } from "./migrate.js";
export { ITEMS_COLUMNS, INDEX_TABLES } from "./schema.js";
export {
  ensureHealthyIndex,
  runIndexStartupChecks,
  validateIndexSchema,
} from "./validate.js";
export type { IndexValidationResult } from "./validate.js";
export { resetIndexSchema } from "./reset.js";
