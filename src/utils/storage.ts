// Unified storage interface for cross-platform token management
export interface StorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
  clear?(): Promise<void> | void;
}

// Browser localStorage adapter
export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(prefix: string = "") {
    this.prefix = prefix;
  }

  getItem(key: string): string | null {
    try {
      return localStorage.getItem(this.prefix + key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(this.prefix + key, value);
    } catch {
      // Silently fail
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      // Silently fail
    }
  }

  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // Silently fail
    }
  }
}

// Token management class
export class TokenManager {
  private adapter: StorageAdapter;
  private tokenKey: string;

  constructor(adapter: StorageAdapter, tokenKey: string = "token") {
    this.adapter = adapter;
    this.tokenKey = tokenKey;
  }

  async getToken(): Promise<string | null> {
    const result = await this.adapter.getItem(this.tokenKey);
    return result;
  }

  async setToken(token: string): Promise<void> {
    await this.adapter.setItem(this.tokenKey, token);
  }

  async removeToken(): Promise<void> {
    await this.adapter.removeItem(this.tokenKey);
  }

  async clear(): Promise<void> {
    if (this.adapter.clear) {
      await this.adapter.clear();
    }
  }
}

// Platform-specific storage keys
export const STORAGE_KEYS = {
  WEB: "ankaa_token",
  MOBILE: "@ankaa:token",
  DEFAULT: "auth_token",
} as const;
