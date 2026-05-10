/**
 * Token store utility
 * Securely stores and manages authentication tokens
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import NodeCache from 'node-cache';
import logger from './logger';
import { TokenData } from '../types';

const TOKEN_FILE = path.join(os.homedir(), '.tinder-mcp-tokens.json');

/**
 * Token store class
 * Manages authentication tokens for users, persisted to disk so tokens
 * survive server restarts and re-authentication is only needed when the
 * Tinder refresh token itself expires (~24h).
 */
class TokenStore {
  private tokenCache: NodeCache;

  constructor() {
    this.tokenCache = new NodeCache({
      stdTTL: 86400,
      checkperiod: 600,
      useClones: false
    });
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(TOKEN_FILE)) return;
      const entries: Record<string, TokenData> = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      const now = Date.now();
      let loaded = 0;
      for (const [userId, tokenData] of Object.entries(entries)) {
        if (tokenData.expiresAt > now) {
          const ttl = Math.floor((tokenData.expiresAt - now) / 1000);
          this.tokenCache.set(userId, tokenData, ttl);
          loaded++;
        }
      }
      if (loaded > 0) logger.info(`Loaded ${loaded} token(s) from disk`);
    } catch (error) {
      logger.warn(`Could not load tokens from disk: ${(error as Error).message}`);
    }
  }

  private saveToDisk(): void {
    try {
      const entries: Record<string, TokenData> = {};
      for (const userId of this.tokenCache.keys()) {
        const tokenData = this.tokenCache.get<TokenData>(userId);
        if (tokenData) entries[userId] = tokenData;
      }
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`Could not save tokens to disk: ${(error as Error).message}`);
    }
  }

  /**
   * Get token data for a user
   * @param userId - User ID
   * @returns Token data or null if not found
   */
  public getToken(userId: string): TokenData | null {
    try {
      return this.tokenCache.get<TokenData>(userId) || null;
    } catch (error) {
      logger.error(`Error getting token for user ${userId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Store token data for a user
   * @param userId - User ID
   * @param tokenData - Token data
   * @returns Success status
   */
  public storeToken(userId: string, tokenData: TokenData): boolean {
    try {
      const now = Date.now();
      const ttl = Math.floor((tokenData.expiresAt - now) / 1000);
      const result = ttl > 0
        ? this.tokenCache.set(userId, tokenData, ttl)
        : this.tokenCache.set(userId, tokenData);
      if (result) this.saveToDisk();
      return result;
    } catch (error) {
      logger.error(`Error storing token for user ${userId}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Remove token data for a user
   * @param userId - User ID
   * @returns Success status
   */
  public removeToken(userId: string): boolean {
    try {
      const result = this.tokenCache.del(userId) > 0;
      if (result) this.saveToDisk();
      return result;
    } catch (error) {
      logger.error(`Error removing token for user ${userId}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Check if token is expired for a user
   * @param userId - User ID
   * @returns True if token is expired or not found
   */
  public isTokenExpired(userId: string): boolean {
    try {
      const tokenData = this.getToken(userId);
      if (!tokenData) return true;
      
      return Date.now() >= tokenData.expiresAt;
    } catch (error) {
      logger.error(`Error checking token expiry for user ${userId}: ${(error as Error).message}`);
      return true; // Assume expired on error
    }
  }

  /**
   * Calculate token expiry time
   * @param ttlMs - TTL in milliseconds (default 24 hours)
   * @returns Expiry timestamp
   */
  public calculateExpiryTime(ttlMs: number = 24 * 60 * 60 * 1000): number {
    return Date.now() + ttlMs;
  }

  /**
   * Get all stored user IDs
   * @returns Array of user IDs
   */
  public getAllUserIds(): string[] {
    return this.tokenCache.keys();
  }

  /**
   * Get stats about token store
   * @returns Stats object
   */
  public getStats(): NodeCache.Stats {
    return this.tokenCache.getStats();
  }
}

// Export singleton instance
export default new TokenStore();