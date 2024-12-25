import { db } from "@db";
import { users, type User, tokenTransactions, tokens } from "@db/schema";
import { eq, sql, and } from 'drizzle-orm';
import { broadcastToUser } from '../ws';

// Simple in-memory cache for balance values
const balanceCache = new Map<string, {
  balance: number;
  timestamp: number;
}>();

const CACHE_TTL = 30000; // 30 seconds

export class BalanceTracker {
  private static instance: BalanceTracker;

  private constructor() {
    // Clear cache periodically
    setInterval(() => {
      const now = Date.now();
      balanceCache.forEach((value, key) => {
        if (now - value.timestamp > CACHE_TTL) {
          balanceCache.delete(key);
        }
      });
    }, CACHE_TTL);

    console.log('[BalanceTracker] Initialized with cache TTL:', CACHE_TTL);
  }

  static getInstance(): BalanceTracker {
    if (!BalanceTracker.instance) {
      BalanceTracker.instance = new BalanceTracker();
    }
    return BalanceTracker.instance;
  }

  async getBalance(username: string): Promise<number> {
    try {
      console.log('[BalanceTracker] Starting balance calculation for:', username);

      // Check cache first
      const cached = balanceCache.get(username);
      const now = Date.now();

      if (cached && (now - cached.timestamp < CACHE_TTL)) {
        console.log('[BalanceTracker] Cache hit:', {
          username,
          balance: cached.balance,
          age: `${(now - cached.timestamp) / 1000}s`
        });
        return cached.balance;
      }

      // Get active tokens count with a more specific query
      const result = await db
        .select({
          activeTokens: sql<number>`COUNT(DISTINCT ${tokens.id})`
        })
        .from(tokens)
        .where(
          and(
            eq(tokens.owner, username),
            eq(tokens.status, 'active')
          )
        );

      const balance = Number(result[0]?.activeTokens || 0);

      // Cache the result
      balanceCache.set(username, {
        balance,
        timestamp: now
      });

      console.log('[BalanceTracker] Calculation complete:', {
        username,
        balance,
        timestamp: new Date().toISOString()
      });

      // Notify via WebSocket
      broadcastToUser(username, 'balance_update', { balance });

      return balance;
    } catch (error) {
      console.error('[BalanceTracker] Error calculating balance:', {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  async forceSyncBalance(username: string): Promise<User> {
    try {
      console.log('[BalanceTracker] Force syncing balance for:', username);

      // Invalidate cache
      this.invalidateCache(username);

      // Calculate actual balance from tokens
      const actualBalance = await this.getBalance(username);

      // Update user's recorded balance
      const [updatedUser] = await db
        .update(users)
        .set({
          tokenBalance: actualBalance,
          updated_at: new Date()
        })
        .where(eq(users.username, username))
        .returning();

      console.log('[BalanceTracker] Force sync completed:', {
        username,
        previousBalance: updatedUser.tokenBalance,
        newBalance: actualBalance,
        timestamp: new Date().toISOString()
      });

      // Ensure WebSocket clients are notified with sync status
      broadcastToUser(username, 'balance_update', { 
        balance: actualBalance,
        synced: true
      });

      return updatedUser;
    } catch (error) {
      console.error('[BalanceTracker] Force sync failed:', {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  invalidateCache(username: string) {
    console.log('[BalanceTracker] Invalidating cache for:', username);
    balanceCache.delete(username);
  }
}

// Export singleton instance
export const balanceTracker = BalanceTracker.getInstance();