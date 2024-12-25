import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';
import { db } from "@db";
import { tokens, users, tokenTransactions } from "@db/schema";
import { sql, eq, and } from 'drizzle-orm';
import { balanceTracker } from '../services/balanceTracker';

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
        timestamp: new Date().toISOString()
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
        metadata: {
          paymentId: tx.paymentId || undefined,
          price: tx.metadata?.totalPrice,
          pricePerToken: tx.metadata?.pricePerToken
        }
      }));

      console.log('[Blockchain] Chain initialization complete:', {
        totalTransactions: this.chain.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Blockchain] Failed to initialize chain:', error);
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
    console.log('[Blockchain] Creating new transaction:', { from, to, amount, metadata });

    try {
      return await db.transaction(async (tx) => {
        // For system transactions (minting), create new tokens
        if (from === 'SYSTEM') {
          return this.mintNewTokens(tx, to, amount, metadata);
        }

        // Get tokens owned by sender
        const senderTokens = await tx
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.owner, from),
              eq(tokens.status, 'active')
            )
          )
          .limit(amount);

        if (senderTokens.length < amount) {
          throw new Error(`Insufficient tokens: have ${senderTokens.length}, need ${amount}`);
        }

        console.log('[Blockchain] Transferring tokens:', {
          from,
          to,
          tokenCount: senderTokens.length
        });

        // Update token ownership
        const tokenIds = senderTokens.map(token => token.id);
        await tx
          .update(tokens)
          .set({
            owner: to,
            metadata: {
              previousTransfers: sql`array_append(COALESCE(${tokens.metadata}->'previousTransfers', '[]'::jsonb), to_jsonb(now()))`
            }
          })
          .where(sql`id = ANY(${tokenIds}::uuid[])`);

        // Record transaction
        const [transaction] = await tx.insert(tokenTransactions).values({
          userId: (await tx.query.users.findFirst({ where: eq(users.username, to) }))?.id,
          type: 'transfer',
          status: 'completed',
          fromAddress: from,
          toAddress: to,
          tokenIds,
          metadata: {
            timestamp: new Date().toISOString()
          }
        }).returning();

        // Add to chain
        const chainTransaction: Transaction = {
          id: transaction.id.toString(),
          from,
          to,
          amount: tokenIds.length,
          timestamp: Date.now(),
          type: 'transfer',
          tokenIds
        };

        this.chain.push(chainTransaction);

        // Invalidate balance caches
        balanceTracker.invalidateCache(to);
        balanceTracker.invalidateCache(from);

        // Force sync balances
        await balanceTracker.forceSyncBalance(to);
        await balanceTracker.forceSyncBalance(from);

        console.log('[Blockchain] Transaction completed:', {
          transactionId: transaction.id,
          tokenCount: tokenIds.length
        });

        return {
          id: transaction.id.toString(),
          tokenIds,
          blockHash: 'immediate'
        };
      });
    } catch (error) {
      console.error('[Blockchain] Transaction failed:', error);
      throw error;
    }
  }

  private async mintNewTokens(
    tx: any,
    to: string,
    amount: number,
    metadata?: {
      paymentId?: string;
      price?: number;
      pricePerToken?: number;
      bonusTokens?: number;
    }
  ): Promise<TransactionResult> {
    // Generate token IDs
    const tokenIds = Array.from(
      { length: amount + (metadata?.bonusTokens || 0) },
      () => uuidv4()
    );

    console.log('[Blockchain] Creating new tokens:', {
      baseTokenCount: amount,
      bonusTokenCount: metadata?.bonusTokens || 0,
      totalTokens: tokenIds.length
    });

    // Create tokens
    const insertedTokens = await tx.insert(tokens).values(
      tokenIds.map(id => ({
        id,
        creator: 'SYSTEM',
        owner: to,
        status: 'active' as const,
        mintedInBlock: 'immediate',
        metadata: {
          createdAt: new Date(),
          previousTransfers: [],
          purchaseInfo: metadata ? {
            paymentId: metadata.paymentId,
            price: metadata.pricePerToken || 1,
            purchaseDate: new Date(),
            reason: 'purchase'
          } : undefined
        }
      }))
    ).returning();

    console.log('[Blockchain] Tokens created:', {
      expectedCount: tokenIds.length,
      actualCount: insertedTokens.length
    });

    // Record transaction
    const [transaction] = await tx.insert(tokenTransactions).values({
      userId: (await tx.query.users.findFirst({ where: eq(users.username, to) }))?.id,
      type: 'mint',
      status: 'completed',
      paymentId: metadata?.paymentId,
      fromAddress: 'SYSTEM',
      toAddress: to,
      tokenIds,
      metadata: {
        baseTokens: amount,
        bonusTokens: metadata?.bonusTokens || 0,
        pricePerToken: metadata?.pricePerToken,
        totalPrice: metadata?.price,
        timestamp: new Date().toISOString()
      }
    }).returning();

    // Add to chain
    const chainTransaction: Transaction = {
      id: transaction.id.toString(),
      from: 'SYSTEM',
      to,
      amount: tokenIds.length,
      timestamp: Date.now(),
      type: 'mint',
      tokenIds,
      metadata
    };

    this.chain.push(chainTransaction);
    return {
      id: transaction.id.toString(),
      tokenIds,
      blockHash: 'immediate'
    };
  }

  getAllTransactions(): Transaction[] {
    return [...this.chain];
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }

  async getBalance(username: string): Promise<number> {
    try {
      console.log('[Blockchain] Fetching balance for:', username);

      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(tokens)
        .where(and(
          eq(tokens.owner, username),
          eq(tokens.status, 'active')
        ));

      const balance = Number(result[0]?.count || 0);
      console.log('[Blockchain] Balance result:', { username, balance });

      return balance;
    } catch (error) {
      console.error('[Blockchain] Balance fetch failed:', error);
      throw error;
    }
  }

  async getTokens(username: string): Promise<Token[]> {
    try {
      console.log('[Blockchain] Fetching tokens for:', username);

      const userTokens = await db.query.tokens.findMany({
        where: and(
          eq(tokens.owner, username),
          eq(tokens.status, 'active')
        ),
        with: {
          transaction: true
        }
      });

      return userTokens.map(token => ({
        id: token.id,
        status: token.status,
        metadata: {
          mintedInBlock: token.mintedInBlock,
          createdAt: token.metadata?.createdAt || new Date(),
          previousTransfers: token.metadata?.previousTransfers || [],
          purchaseInfo: token.metadata?.purchaseInfo
        },
        creator: token.creator,
        owner: token.owner,
        mintedInBlock: token.mintedInBlock,
        transactionId: token.transactionId
      }));
    } catch (error) {
      console.error('[Blockchain] Token fetch failed:', error);
      throw error;
    }
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