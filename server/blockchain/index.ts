import { v4 as uuidv4 } from 'uuid';
import type { Transaction, TransactionResult } from '../../client/src/lib/blockchain/types';
import { db } from "@db";
import { users, tokenTransactions } from "@db/schema";
import { sql, eq } from 'drizzle-orm';
import { balanceTracker } from '../services/balanceTracker';

class Blockchain {
  private chain: Transaction[];
  private pendingTransactions: Transaction[];

  constructor() {
    console.log('Initializing blockchain...');
    this.chain = [];
    this.pendingTransactions = [];
  }

  getAllTransactions(): Transaction[] {
    return [...this.chain];
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }

  async getBalance(address: string): Promise<number> {
    console.log('[Balance Check] Starting balance calculation for:', address);
    try {
      const balance = await balanceTracker.getBalance(address);
      console.log('[Balance Check] Result:', { 
        address, 
        calculatedBalance: balance,
        timestamp: new Date().toISOString()
      });
      return balance;
    } catch (error) {
      console.error('[Balance Check] Error calculating balance:', {
        address,
        error,
        timestamp: new Date().toISOString()
      });
      return 0;
    }
  }

  async createTransaction(from: string, to: string, amount: number, metadata?: { paymentId?: string; price?: number; bonusTokens?: number }): Promise<TransactionResult> {
    console.log('[Transaction Start] Creating transaction:', { 
      from, 
      to, 
      amount, 
      metadata,
      timestamp: new Date().toISOString() 
    });

    if (!from || !to) {
      throw new Error('Transaction must include from and to addresses');
    }

    if (amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    // Check balance (except for system transactions)
    if (from !== 'SYSTEM') {
      const balance = await balanceTracker.getBalance(from);
      console.log('[Balance Check] Pre-transaction:', { 
        address: from, 
        currentBalance: balance, 
        requiredAmount: amount 
      });
      if (balance < amount) {
        throw new Error(`Insufficient balance: ${balance} < ${amount}`);
      }
    }

    try {
      // Record transaction in a single database operation
      const result = await db.transaction(async (tx) => {
        // Get user IDs for transaction recording
        const [toUser] = await tx
          .select()
          .from(users)
          .where(eq(users.username, to))
          .limit(1);

        if (!toUser) {
          throw new Error(`Recipient user not found: ${to}`);
        }

        // Record the transaction
        const [transaction] = await tx.insert(tokenTransactions).values({
          userId: toUser.id,
          amount: amount + (metadata?.bonusTokens || 0),
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          fromAddress: from,
          toAddress: to,
          metadata: {
            ...metadata,
            baseTokens: amount,
            bonusTokens: metadata?.bonusTokens || 0
          },
          timestamp: new Date()
        }).returning();

        // Update balances
        const totalTokens = amount + (metadata?.bonusTokens || 0);
        await balanceTracker.addTokens(to, totalTokens);

        if (from !== 'SYSTEM') {
          await balanceTracker.addTokens(from, -amount);
        }

        // Create transaction record for the chain
        const chainTransaction: Transaction = {
          id: transaction.id.toString(),
          from,
          to,
          amount: totalTokens,
          timestamp: transaction.timestamp.getTime(),
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          tokenIds: [], // Empty array since we don't track individual tokens anymore
          metadata: transaction.metadata
        };

        this.chain.push(chainTransaction);

        return {
          id: transaction.id.toString(),
          tokenIds: [], // Empty array since we don't track individual tokens anymore
          blockHash: 'immediate'
        };
      });

      console.log('[Transaction Complete] Successfully recorded transaction');
      return result;

    } catch (error) {
      console.error('[Transaction Error] Failed:', {
        error,
        from,
        to,
        amount,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}

// Create singleton instance
console.log('Creating blockchain service singleton...');
const blockchain = new Blockchain();

export const blockchainService = {
  createTransaction: blockchain.createTransaction.bind(blockchain),
  getAllTransactions: () => blockchain.getAllTransactions(),
  getPendingTransactions: () => blockchain.getPendingTransactions(),
  getBalance: (address: string) => balanceTracker.getBalance(address)
};