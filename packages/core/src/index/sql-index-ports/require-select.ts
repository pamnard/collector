/** Adapter stubs for methods that need {@link SqlVaultIndexStore}'s select(). */
export function requireSqlSelect(method: string): Promise<never> {
  return Promise.reject(
    new Error(`${method} requires select(); use SqlVaultIndexStore instead`),
  );
}
