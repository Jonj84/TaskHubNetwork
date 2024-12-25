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
      console.log('[Balance] Fetching balance for:', username);
      const result = await db
        .select({ count: count() })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const balance = result[0].count;
      console.log('[Balance] Current balance:', { username, balance });
      return balance;
    } catch (error) {
      console.error('[Balance] Error fetching balance:', { username, error });
      throw error;
    }
  }

  async updateBalance(username: string): Promise<User> {
    try {
      console.log('[Balance] Starting balance update for:', username);
      
      // Get current token count
      const result = await db
        .select({ count: count() })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const tokenCount = result[0].count;
      console.log('[Balance] Token count:', { username, count: tokenCount });

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
        newBalance: updatedUser.tokenBalance
      });

      return updatedUser;
    } catch (error) {
      console.error('[Balance] Update failed:', { username, error });
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
      const tokenCount = await this.getBalance(username);

      // Get recorded balance from user table
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      const isValid = user.tokenBalance === tokenCount;
      console.log('[Balance] Verification result:', {
        username,
        actual: tokenCount,
        recorded: user.tokenBalance,
        isValid
      });

      return {
        isValid,
        actual: tokenCount,
        recorded: user.tokenBalance
      };
    } catch (error) {
      console.error('[Balance] Verification failed:', { username, error });
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
          recorded: verification.recorded
        });
        
        return await this.updateBalance(username);
      }

      console.log('[Balance] No reconciliation needed:', { username });
      return (await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1))[0];
    } catch (error) {
      console.error('[Balance] Reconciliation failed:', { username, error });
      throw error;
    }
  }

  // Add tokens with balance update in a single transaction
  async addTokens(username: string, amount: number): Promise<User> {
    try {
      console.log('[Balance] Adding tokens:', { username, amount });
      
      const [updatedUser] = await db
        .update(users)
        .set({
          tokenBalance: sql`token_balance + ${amount}`,
          updated_at: new Date()
        })
        .where(eq(users.username, username))
        .returning();

      console.log('[Balance] Tokens added:', {
        username,
        added: amount,
        newBalance: updatedUser.tokenBalance
      });

      return updatedUser;
    } catch (error) {
      console.error('[Balance] Failed to add tokens:', { username, amount, error });
      throw error;
    }
  }
}

// Export singleton instance
export const balanceTracker = BalanceTracker.getInstance();
