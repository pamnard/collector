/** OS keychain availability for sync-plugin secrets (#30). */
export interface CredentialsAvailability {
  available: boolean;
  /** Present when `available` is false — never a silent half-broken store. */
  reason?: string;
}

/** Plugin secret identity (#30). Account in keychain = `{pluginId}.{key}`. */
export interface CredentialRef {
  pluginId: string;
  key: string;
}

/**
 * Sync-plugin secrets in OS keychain via domain host (#30).
 * Never vault files / app-settings JSON. UI uses set/has/delete; sync uses get.
 */
export interface CredentialsPort {
  setCredential(input: CredentialRef & { secret: string }): Promise<void>;
  getCredential(input: CredentialRef): Promise<string | null>;
  hasCredential(input: CredentialRef): Promise<boolean>;
  deleteCredential(input: CredentialRef): Promise<void>;
  getCredentialsAvailability(): Promise<CredentialsAvailability>;
}
