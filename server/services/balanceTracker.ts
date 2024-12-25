import { db } from "@db";
import { users, type User, tokenTransactions, tokens } from "@db/schema";
import { eq, sql, and } from 'drizzle-orm';

// Simple in-memory cache for balance values
const balanceCache = new Map<string, {
  balance: number;
  timestamp: number;
  transactionCount: number;
}>();

const CACHE_TTL = 30000; // 30 seconds
const FORCE_REFRESH_TRANSACTION_COUNT = 10; // Force refresh after 10 new transactions

export class BalanceTracker {
  private static instance: BalanceTracker;

  private constructor() {
    // Clear cache periodically
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of balanceCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          balanceCache.delete(key);
        }
      }
    }, CACHE_TTL);
  }

  static getInstance(): BalanceTracker {
    if (!BalanceTracker.instance) {
      BalanceTracker.instance = new BalanceTracker();
    }
    return BalanceTracker.instance;
  }

  async getBalance(username: string): Promise<number> {
    try {
      // Check cache first
      const cached = balanceCache.get(username);
      const now = Date.now();

      if (cached && (now - cached.timestamp < CACHE_TTL)) {
        console.log('[Balance] Cache hit:', {
          username,
          balance: cached.balance,
          age: `${(now - cached.timestamp) / 1000}s`
        });
        return cached.balance;
      }

      console.log('[Balance] Cache miss, calculating balance for:', username);

      // Get active tokens count in a single query
      const result = await db
        .select({
          activeTokens: sql<number>`COUNT(*)`,
          transactionCount: sql<number>`(
            SELECT COUNT(*) 
            FROM ${tokenTransactions} 
            WHERE ${tokenTransactions.toAddress} = ${username} 
            OR ${tokenTransactions.fromAddress} = ${username}
          )`
        })
        .from(tokens)
        .where(
          and(
            eq(tokens.owner, username),
            eq(tokens.status, 'active')
          )
        );

      const balance = Number(result[0]?.activeTokens || 0);
      const transactionCount = Number(result[0]?.transactionCount || 0);

      // Cache the result
      balanceCache.set(username, {
        balance,
        timestamp: now,
        transactionCount
      });

      console.log('[Balance] Calculation complete:', {
        username,
        balance,
        transactionCount,
        timestamp: new Date().toISOString()
      });

      return balance;
    } catch (error) {
      console.error('[Balance] Error calculating balance:', {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async forceSyncBalance(username: string): Promise<User> {
    try {
      console.log('[Balance] Force syncing balance for:', username);
      balanceCache.delete(username); // Clear cache for this user

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

      console.log('[Balance] Force sync completed:', {
        username,
        previousBalance: updatedUser.tokenBalance,
        newBalance: actualBalance,
        timestamp: new Date().toISOString()
      });

      return updatedUser;
    } catch (error) {
      console.error('[Balance] Force sync failed:', {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async addTokens(username: string, amount: number): Promise<User> {
    try {
      console.log('[Balance] Starting addTokens transaction:', {
        username,
        amount,
        timestamp: new Date().toISOString()
      });

      return await db.transaction(async (tx) => {
        // Clear cache before the transaction
        balanceCache.delete(username);

        // Get current balance
        const currentBalance = await this.getBalance(username);

        // Update user's balance atomically
        const [updatedUser] = await tx
          .update(users)
          .set({
            tokenBalance: sql`${users.tokenBalance} + ${amount}`,
            updated_at: new Date()
          })
          .where(eq(users.username, username))
          .returning();

        console.log('[Balance] Updated user balance:', {
          username,
          previousBalance: currentBalance,
          addedAmount: amount,
          newBalance: updatedUser.tokenBalance,
          timestamp: new Date().toISOString()
        });

        return updatedUser;
      });
    } catch (error) {
      console.error('[Balance] Failed to add tokens:', {
        username,
        amount,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  // Invalidate cache for a specific user
  invalidateCache(username: string) {
    balanceCache.delete(username);
  }
}

// Export singleton instance
export const balanceTracker = BalanceTracker.getInstance();