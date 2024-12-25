import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';
import { db } from "@db";
import { tokens, users, tokenTransactions } from "@db/schema";
import { sql, eq, count } from 'drizzle-orm';

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
      // Count tokens owned by the address
      const result = await db
        .select({ count: count() })
        .from(tokens)
        .where(eq(tokens.owner, address));

      const balance = Number(result[0].count);
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
      const balance = await this.getBalance(from);
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
      // Create tokens and record transaction in a single database transaction
      const result = await db.transaction(async (tx) => {
        // Generate token IDs
        const baseTokenIds = Array.from({ length: amount }, () => uuidv4());
        let bonusTokenIds: string[] = [];

        if (metadata?.bonusTokens && metadata.bonusTokens > 0) {
          bonusTokenIds = Array.from({ length: metadata.bonusTokens }, () => uuidv4());
        }

        // Create base tokens
        const baseTokensToCreate = baseTokenIds.map(tokenId => ({
          id: tokenId,
          creator: from,
          owner: to,
          mintedInBlock: 'immediate',
          metadata: {
            createdAt: new Date(),
            previousTransfers: [],
            purchaseInfo: metadata ? {
              paymentId: metadata.paymentId,
              price: metadata.price,
              purchaseDate: new Date()
            } : undefined
          }
        }));

        // Create bonus tokens if applicable
        const bonusTokensToCreate = bonusTokenIds.map(tokenId => ({
          id: tokenId,
          creator: 'SYSTEM',
          owner: to,
          mintedInBlock: 'immediate',
          metadata: {
            createdAt: new Date(),
            previousTransfers: [],
            purchaseInfo: {
              reason: 'volume_bonus',
              originalPurchaseId: metadata?.paymentId,
              purchaseDate: new Date()
            }
          }
        }));

        // Insert tokens
        await tx.insert(tokens).values([...baseTokensToCreate, ...bonusTokensToCreate]);

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
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          fromAddress: from,
          toAddress: to,
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          metadata: {
            ...metadata,
            baseTokens: amount,
            bonusTokens: metadata?.bonusTokens || 0
          },
          timestamp: new Date()
        }).returning();

        // Create transaction record for the chain
        const chainTransaction: Transaction = {
          id: transaction.id.toString(),
          from,
          to,
          amount: amount + (metadata?.bonusTokens || 0),
          timestamp: transaction.timestamp.getTime(),
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          metadata: transaction.metadata
        };

        this.chain.push(chainTransaction);

        return {
          id: transaction.id.toString(),
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          blockHash: 'immediate'
        };
      });

      console.log('[Transaction Complete] Successfully created tokens and recorded transaction');
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
  getBalance: (address: string) => blockchain.getBalance(address)
};