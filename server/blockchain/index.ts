import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';
import { db } from "@db";
import { tokens, users, tokenTransactions } from "@db/schema";
import { sql, eq, and } from 'drizzle-orm';

class Blockchain {
  private chain: Transaction[];
  private pendingTransactions: Transaction[];

  constructor() {
    console.log('[Blockchain] Initializing blockchain service');
    this.chain = [];
    this.pendingTransactions = [];
    this.initializeChain();
  }

  private async initializeChain() {
    try {
      console.log('[Blockchain] Starting chain initialization');

      // Get all token transactions with their associated tokens
      const existingTransactions = await db.query.tokenTransactions.findMany({
        with: {
          tokens: true,
          user: true
        },
        orderBy: (tokenTransactions, { asc }) => [asc(tokenTransactions.timestamp)]
      });

      console.log('[Blockchain] Loaded transactions:', {
        count: existingTransactions.length,
        timestamp: new Date().toISOString(),
        firstTransaction: existingTransactions[0]?.id || 'none',
        lastTransaction: existingTransactions[existingTransactions.length - 1]?.id || 'none'
      });

      // Convert to blockchain transactions
      this.chain = existingTransactions.map(tx => ({
        id: tx.id.toString(),
        from: tx.fromAddress || 'SYSTEM',
        to: tx.toAddress || tx.user.username,
        amount: tx.tokenIds?.length || 0,
        timestamp: tx.timestamp.getTime(),
        type: tx.type as 'transfer' | 'mint',
        tokenIds: tx.tokenIds || [],
        metadata: tx.metadata
      }));

      console.log('[Blockchain] Chain initialization complete:', {
        totalTransactions: this.chain.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Blockchain] Failed to initialize chain:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  async getTokens(username: string): Promise<Token[]> {
    try {
      console.log('[Blockchain] Fetching tokens for user:', username);
      const userTokens = await db.query.tokens.findMany({
        where: and(
          eq(tokens.owner, username),
          eq(tokens.status, 'active')
        ),
        with: {
          transaction: true
        }
      });

      console.log('[Blockchain] Token query result:', {
        username,
        tokenCount: userTokens.length,
        activeTokens: userTokens.filter(t => t.status === 'active').length,
        timestamp: new Date().toISOString()
      });

      return userTokens.map(token => ({
        id: token.id,
        status: token.status,
        metadata: token.metadata || {
          createdAt: token.created_at,
          previousTransfers: []
        },
        creator: token.creator,
        owner: token.owner,
        mintedInBlock: token.mintedInBlock,
        transactionId: token.transactionId
      }));
    } catch (error) {
      console.error('[Blockchain] Failed to fetch tokens:', {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  async getBalance(username: string): Promise<number> {
    try {
      console.log('[Blockchain] Starting balance calculation for:', username);

      // Get active tokens count
      const result = await db
        .select({
          activeTokens: sql<number>`COUNT(*)`
        })
        .from(tokens)
        .where(
          and(
            eq(tokens.owner, username),
            eq(tokens.status, 'active')
          )
        );

      const balance = Number(result[0]?.activeTokens || 0);

      console.log('[Blockchain] Balance calculated:', {
        username,
        balance,
        timestamp: new Date().toISOString()
      });

      return balance;
    } catch (error) {
      console.error('[Blockchain] Balance calculation error:', {
        username,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  async createTransaction(
    from: string,
    to: string,
    amount: number,
    metadata?: {
      paymentId?: string;
      price?: number;
      pricePerToken?: number;
      bonusTokens?: number;
    }
  ): Promise<TransactionResult> {
    const startTime = Date.now();
    console.log('[Transaction] Starting new transaction:', {
      from,
      to,
      amount,
      metadata,
      timestamp: new Date().toISOString()
    });

    try {
      if (!from || !to) {
        throw new Error('Transaction must include from and to addresses');
      }

      if (amount <= 0) {
        throw new Error('Transaction amount must be positive');
      }

      // Skip balance check for system transactions
      if (from !== 'SYSTEM') {
        const balance = await this.getBalance(from);
        if (balance < amount) {
          throw new Error(`Insufficient balance: ${balance} < ${amount}`);
        }
      }

      return await db.transaction(async (tx) => {
        // Verify payment hasn't been processed
        if (metadata?.paymentId) {
          const existingTx = await tx.query.tokenTransactions.findFirst({
            where: eq(tokenTransactions.paymentId, metadata.paymentId)
          });

          if (existingTx) {
            console.log('[Transaction] Payment already processed:', {
              paymentId: metadata.paymentId,
              existingTxId: existingTx.id
            });
            throw new Error('Payment already processed');
          }
        }

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
        const bonusTokenIds = metadata?.bonusTokens
          ? Array.from({ length: metadata.bonusTokens }, () => uuidv4())
          : [];

        console.log('[Transaction] Creating tokens:', {
          baseTokenCount: baseTokenIds.length,
          bonusTokenCount: bonusTokenIds.length,
          timestamp: new Date().toISOString()
        });

        // Create tokens with proper metadata
        const tokensToCreate = [
          ...baseTokenIds.map(id => ({
            id,
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
                purchaseDate: new Date(),
                reason: 'purchase' as const
              } : undefined
            }
          })),
          ...bonusTokenIds.map(id => ({
            id,
            creator: 'SYSTEM',
            owner: to,
            status: 'active' as const,
            mintedInBlock: 'immediate',
            metadata: {
              createdAt: new Date(),
              previousTransfers: [],
              purchaseInfo: {
                paymentId: metadata?.paymentId,
                price: 0,
                purchaseDate: new Date(),
                reason: 'bonus' as const
              }
            }
          }))
        ];

        // Insert tokens atomically and verify
        const insertedTokens = await tx.insert(tokens).values(tokensToCreate).returning();
        console.log('[Transaction] Tokens created:', {
          expectedCount: tokensToCreate.length,
          actualCount: insertedTokens.length,
          timestamp: new Date().toISOString()
        });

        if (insertedTokens.length !== tokensToCreate.length) {
          throw new Error(`Token creation failed: Expected ${tokensToCreate.length} tokens but created ${insertedTokens.length}`);
        }

        // Record transaction with detailed metadata
        const [transaction] = await tx.insert(tokenTransactions).values({
          userId: toUser.id,
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          status: 'completed',
          paymentId: metadata?.paymentId,
          fromAddress: from,
          toAddress: to,
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          metadata: {
            baseTokens: amount,
            bonusTokens: metadata?.bonusTokens || 0,
            pricePerToken: metadata?.pricePerToken,
            totalPrice: metadata?.price,
            timestamp: new Date().toISOString()
          }
        }).returning();

        // Verify transaction was recorded
        if (!transaction?.id) {
          throw new Error('Failed to record transaction');
        }

        const chainTransaction: Transaction = {
          id: transaction.id.toString(),
          from,
          to,
          amount: tokensToCreate.length,
          timestamp: Date.now(),
          type: from === 'SYSTEM' ? 'mint' : 'transfer',
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          tokens: tokensToCreate, // Add tokens to chainTransaction
          metadata: metadata
        };

        this.chain.push(chainTransaction);

        const duration = Date.now() - startTime;
        console.log('[Transaction] Successfully completed:', {
          transactionId: transaction.id,
          totalTokens: tokensToCreate.length,
          baseTokens: baseTokenIds.length,
          bonusTokens: bonusTokenIds.length,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });

        return {
          id: transaction.id.toString(),
          tokenIds: [...baseTokenIds, ...bonusTokenIds],
          blockHash: 'immediate'
        };
      });
    } catch (error) {
      console.error('[Transaction] Failed:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        from,
        to,
        amount,
        duration: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  getAllTransactions(): Transaction[] {
    return [...this.chain];
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }
}

// Initialize blockchain service
const blockchain = new Blockchain();

// Export individual methods to ensure type safety and proper function binding
export const blockchainService = {
  createTransaction: blockchain.createTransaction.bind(blockchain),
  getAllTransactions: blockchain.getAllTransactions.bind(blockchain),
  getPendingTransactions: blockchain.getPendingTransactions.bind(blockchain),
  getBalance: blockchain.getBalance.bind(blockchain),
  getTokens: blockchain.getTokens.bind(blockchain)
} as const;