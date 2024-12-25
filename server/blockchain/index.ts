import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';
import { db } from "@db";
import { tokens, users, tokenTransactions } from "@db/schema";
import { sql, eq, count, and } from 'drizzle-orm';

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
      // Count active tokens owned by the address
      const result = await db
        .select({ count: count() })
        .from(tokens)
        .where(
          and(
            eq(tokens.owner, address),
            eq(tokens.status, 'active')
          )
        );

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
      throw error;
    }
  }

  async createTransaction(from: string, to: string, amount: number, metadata?: { 
    paymentId?: string; 
    price?: number; 
    pricePerToken?: number;
    bonusTokens?: number 
  }): Promise<TransactionResult> {
    try {
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

      // Check if this payment was already processed
      if (metadata?.paymentId) {
        const existingTransaction = await db.query.tokenTransactions.findFirst({
          where: eq(tokenTransactions.paymentId, metadata.paymentId)
        });

        if (existingTransaction) {
          console.log('[Transaction] Payment already processed:', {
            paymentId: metadata.paymentId,
            existingTransaction: existingTransaction.id
          });
          throw new Error('Payment already processed');
        }
      }

      // Create tokens and record transaction in a single database transaction
      const result = await db.transaction(async (tx) => {
        console.log('[Transaction] Starting database transaction');

        // Get user IDs for transaction recording
        const [toUser] = await tx
          .select()
          .from(users)
          .where(eq(users.username, to))
          .limit(1);

        if (!toUser) {
          throw new Error(`Recipient user not found: ${to}`);
        }

        // Generate token IDs
        const baseTokenIds = Array.from({ length: amount }, () => uuidv4());
        let bonusTokenIds: string[] = [];

        if (metadata?.bonusTokens && metadata.bonusTokens > 0) {
          bonusTokenIds = Array.from({ length: metadata.bonusTokens }, () => uuidv4());
        }

        console.log('[Transaction] Generated token IDs:', {
          baseTokens: baseTokenIds.length,
          bonusTokens: bonusTokenIds.length
        });

        // Create base tokens
        const baseTokensToCreate = baseTokenIds.map(tokenId => ({
          id: tokenId,
          creator: from,
          owner: to,
          status: 'active' as const,
          mintedInBlock: 'immediate',
          metadata: {
            createdAt: new Date(),
            previousTransfers: [],
            purchaseInfo: metadata ? {
              paymentId: metadata.paymentId,
              price: metadata.pricePerToken || 1.00,
              purchaseDate: new Date()
            } : undefined
          }
        }));

        // Create bonus tokens if applicable
        const bonusTokensToCreate = bonusTokenIds.map(tokenId => ({
          id: tokenId,
          creator: 'SYSTEM',
          owner: to,
          status: 'active' as const,
          mintedInBlock: 'immediate',
          metadata: {
            createdAt: new Date(),
            previousTransfers: [],
            purchaseInfo: {
              reason: 'volume_bonus',
              originalPurchaseId: metadata?.paymentId,
              price: 0,
              purchaseDate: new Date()
            }
          }
        }));

        // Insert tokens
        const insertedTokens = await tx.insert(tokens).values([...baseTokensToCreate, ...bonusTokensToCreate]);

        console.log('[Transaction] Inserted tokens:', {
          count: insertedTokens.rowCount,
          timestamp: new Date().toISOString()
        });

        // Record the transaction
        const [transaction] = await tx.insert(tokenTransactions).values({
          userId: toUser.id,
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          status: 'completed',
          paymentId: metadata?.paymentId,
          fromAddress: from,
          toAddress: to,
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          metadata: {
            ...metadata,
            baseTokens: amount,
            bonusTokens: metadata?.bonusTokens || 0,
            timestamp: new Date().toISOString()
          },
          timestamp: new Date()
        }).returning();

        console.log('[Transaction] Recorded transaction:', {
          id: transaction.id,
          type: transaction.type,
          status: transaction.status,
          tokenCount: transaction.tokenIds?.length
        });

        // Create transaction record for the chain
        const chainTransaction: Transaction = {
          id: transaction.id.toString(),
          from,
          to,
          amount: amount + (metadata?.bonusTokens || 0),
          timestamp: transaction.timestamp.getTime(),
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          metadata: metadata
        };

        this.chain.push(chainTransaction);

        return {
          id: transaction.id.toString(),
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          blockHash: 'immediate'
        };
      });

      console.log('[Transaction Complete] Successfully created tokens and recorded transaction:', {
        transactionId: result.id,
        tokenCount: result.tokenIds.length,
        timestamp: new Date().toISOString()
      });

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