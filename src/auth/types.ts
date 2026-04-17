/**
 * Authentication provider interface.
 */

export interface AuthProvider {
  getAuthHeader(): Promise<string>;
}

export interface AdoConfig {
  orgUrl: string;
  defaultProject?: string;
  auth: AuthProvider;
  apiVersion?: string;
}
