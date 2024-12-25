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
        tokenIds: tx.tokenIds || []
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
    amount: number
  ): Promise<TransactionResult> {
    console.log('[Blockchain] Creating new transaction:', { from, to, amount });

    try {
      return await db.transaction(async (tx) => {
        // For system transactions (minting), create new tokens
        if (from === 'SYSTEM') {
          throw new Error('System transactions not allowed here');
        }

        // Get tokens owned by sender
        const senderTokens = await tx
          .select({
            id: tokens.id,
            owner: tokens.owner,
            status: tokens.status
          })
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

        // Update tokens ownership
        await tx
          .update(tokens)
          .set({
            owner: to,
            updated_at: new Date()
          })
          .where(
            and(
              sql`id = ANY(${sql.array(tokenIds, 'uuid')})`,
              eq(tokens.status, 'active')
            )
          );

        // Record transaction
        const [transaction] = await tx
          .insert(tokenTransactions)
          .values({
            type: 'transfer',
            status: 'completed',
            fromAddress: from,
            toAddress: to,
            tokenIds,
            timestamp: new Date(),
            metadata: {
              timestamp: new Date().toISOString()
            }
          })
          .returning();

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

      const userTokens = await db
        .select({
          id: tokens.id,
          status: tokens.status,
          owner: tokens.owner,
          creator: tokens.creator,
          mintedInBlock: tokens.mintedInBlock,
          metadata: tokens.metadata
        })
        .from(tokens)
        .where(and(
          eq(tokens.owner, username),
          eq(tokens.status, 'active')
        ));

      return userTokens.map(token => ({
        id: token.id,
        status: token.status,
        metadata: {
          mintedInBlock: token.mintedInBlock,
          createdAt: token.metadata?.createdAt || new Date(),
          previousTransfers: token.metadata?.previousTransfers || []
        },
        creator: token.creator,
        owner: token.owner
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