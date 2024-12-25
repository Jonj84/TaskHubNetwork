import { db } from "@db";
import { users, type User, tokenTransactions } from "@db/schema";
import { eq, sql, sum } from 'drizzle-orm';

export class BalanceTracker {
  private static instance: BalanceTracker;

  private constructor() {}

  static getInstance(): BalanceTracker {
    if (!BalanceTracker.instance) {
      BalanceTracker.instance = new BalanceTracker();
    }
    return BalanceTracker.instance;
  }

  async getBalance(username: string): Promise<number> {
    try {
      console.log('[Balance] Starting balance calculation for:', username);

      // Get user's transactions
      const result = await db
        .select({
          balance: sql<number>`COALESCE(SUM(CASE 
            WHEN ${tokenTransactions.toAddress} = ${username} THEN amount 
            WHEN ${tokenTransactions.fromAddress} = ${username} THEN -amount 
            ELSE 0 
          END), 0)`
        })
        .from(tokenTransactions)
        .where(sql`${tokenTransactions.toAddress} = ${username} OR ${tokenTransactions.fromAddress} = ${username}`);

      const balance = Number(result[0].balance);
      console.log('[Balance] Current balance calculation:', { 
        username, 
        balance,
        timestamp: new Date().toISOString()
      });
      return balance;
    } catch (error) {
      console.error('[Balance] Error calculating balance:', { 
        username, 
        error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async forceSyncBalance(username: string): Promise<User> {
    try {
      console.log('[Balance] Force syncing balance for:', username);

      // Calculate actual balance from transactions
      const actualBalance = await this.getBalance(username);
      console.log('[Balance] Actual balance calculated:', {
        username,
        actualBalance,
        timestamp: new Date().toISOString()
      });

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
        error,
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
        // Get current balance
        const currentBalance = await this.getBalance(username);

        // Update user's balance atomically
        const [updatedUser] = await tx
          .update(users)
          .set({
            tokenBalance: sql`token_balance + ${amount}`,
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
        error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}

// Export singleton instance
export const balanceTracker = BalanceTracker.getInstance();