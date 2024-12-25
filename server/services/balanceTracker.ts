import { db } from "@db";
import { tokens, users, type User } from "@db/schema";
import { eq, count, sql } from "drizzle-orm";

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
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const balance = Number(result[0].count);
      console.log('[Balance] Current balance calculation:', { 
        username, 
        balance,
        query: 'SELECT COUNT(*) FROM tokens WHERE owner = $1',
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

      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const actualBalance = Number(result[0].count);
      console.log('[Balance] Actual token count:', {
        username,
        actualBalance,
        timestamp: new Date().toISOString()
      });

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

  async updateBalance(username: string): Promise<User> {
    try {
      console.log('[Balance] Starting balance update for:', username);

      // Get current token count with detailed logging
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const tokenCount = Number(result[0].count);
      console.log('[Balance] Token count query result:', { 
        username, 
        count: tokenCount,
        query: 'SELECT COUNT(*) FROM tokens WHERE owner = $1',
        timestamp: new Date().toISOString()
      });

      // Update user's balance in database
      const [updatedUser] = await db
        .update(users)
        .set({
          tokenBalance: tokenCount,
          updated_at: new Date()
        })
        .where(eq(users.username, username))
        .returning();

      console.log('[Balance] Update successful:', {
        username,
        previousTokenCount: tokenCount,
        newBalance: updatedUser.tokenBalance,
        timestamp: new Date().toISOString()
      });

      return updatedUser;
    } catch (error) {
      console.error('[Balance] Update failed:', { 
        username, 
        error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async verifyBalance(username: string): Promise<{
    isValid: boolean;
    actual: number;
    recorded: number;
  }> {
    try {
      console.log('[Balance] Starting verification for:', username);

      // Get actual token count
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const tokenCount = Number(result[0].count);

      // Get recorded balance from user table
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      const isValid = user.tokenBalance === tokenCount;
      console.log('[Balance] Verification details:', {
        username,
        actualTokenCount: tokenCount,
        recordedBalance: user.tokenBalance,
        isValid,
        timestamp: new Date().toISOString()
      });

      return {
        isValid,
        actual: tokenCount,
        recorded: user.tokenBalance
      };
    } catch (error) {
      console.error('[Balance] Verification failed:', { 
        username, 
        error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async reconcileBalance(username: string): Promise<User> {
    try {
      console.log('[Balance] Starting reconciliation for:', username);
      const verification = await this.verifyBalance(username);

      if (!verification.isValid) {
        console.log('[Balance] Reconciliation needed:', {
          username,
          actual: verification.actual,
          recorded: verification.recorded,
          timestamp: new Date().toISOString()
        });

        return await this.forceSyncBalance(username);
      }

      console.log('[Balance] No reconciliation needed:', { 
        username,
        balance: verification.actual,
        timestamp: new Date().toISOString()
      });

      return (await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1))[0];
    } catch (error) {
      console.error('[Balance] Reconciliation failed:', { 
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
        // First verify current balance
        const currentBalance = await this.getBalance(username);
        console.log('[Balance] Current balance before add:', {
          username,
          currentBalance,
          addingAmount: amount,
          timestamp: new Date().toISOString()
        });

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

        // Verify final balance matches expectations
        const finalBalance = await this.getBalance(username);
        if (finalBalance !== currentBalance + amount) {
          console.warn('[Balance] Balance mismatch after update:', {
            username,
            expectedBalance: currentBalance + amount,
            actualBalance: finalBalance,
            timestamp: new Date().toISOString()
          });

          // Force sync if there's a mismatch
          return await this.forceSyncBalance(username);
        }

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