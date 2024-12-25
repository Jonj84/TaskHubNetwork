import { db } from "@db";
import { users, type User, tokenTransactions, tokens } from "@db/schema";
import { eq, sql, and } from 'drizzle-orm';
import { broadcastToUser } from '../ws';

// Simple in-memory cache for balance values
const balanceCache = new Map<string, {
  balance: number;
  timestamp: number;
  transactionCount: number; // Track number of transactions for cache invalidation
}>();

const CACHE_TTL = 15000; // 15 seconds - reduced for more frequent updates

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

      // Get transaction count for cache validation
      const txCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tokenTransactions)
        .where(eq(tokenTransactions.toAddress, username));

      const currentTxCount = Number(txCountResult[0]?.count || 0);

      // Check cache
      const cached = balanceCache.get(username);
      const now = Date.now();

      if (cached && 
          (now - cached.timestamp < CACHE_TTL) && 
          cached.transactionCount === currentTxCount) {
        console.log('[BalanceTracker] Cache hit:', {
          username,
          balance: cached.balance,
          age: `${(now - cached.timestamp) / 1000}s`,
          txCount: currentTxCount
        });
        return cached.balance;
      }

      // Calculate active tokens
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

      // Update cache with transaction count
      balanceCache.set(username, {
        balance,
        timestamp: now,
        transactionCount: currentTxCount
      });

      console.log('[BalanceTracker] Calculation complete:', {
        username,
        balance,
        txCount: currentTxCount,
        timestamp: new Date().toISOString()
      });

      // Broadcast update
      broadcastToUser(username, 'balance_update', { 
        balance,
        timestamp: now,
        transactionCount: currentTxCount
      });

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

      // Get user record first
      const user = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1)
        .then(rows => rows[0]);

      if (!user) {
        console.error('[BalanceTracker] User not found:', username);
        throw new Error(`User not found: ${username}`);
      }

      // Invalidate cache
      balanceCache.delete(username);

      // Calculate actual balance from tokens
      const actualBalance = await this.getBalance(username);

      // Update user's recorded balance
      const [updatedUser] = await db
        .update(users)
        .set({
          token_balance: actualBalance,
          updated_at: new Date()
        })
        .where(eq(users.id, user.id))
        .returning();

      if (!updatedUser) {
        throw new Error(`Failed to update balance for user: ${username}`);
      }

      console.log('[BalanceTracker] Force sync completed:', {
        username,
        userId: user.id,
        previousBalance: user.token_balance,
        newBalance: actualBalance,
        timestamp: new Date().toISOString()
      });

      // Ensure WebSocket clients are notified with sync status
      broadcastToUser(username, 'balance_update', { 
        balance: actualBalance,
        synced: true,
        timestamp: Date.now()
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