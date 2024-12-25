import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';
import { db } from "@db";
import { tokens, users, tokenTransactions } from "@db/schema";
import { sql, eq, and, inArray } from 'drizzle-orm';
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
      const existingTransactions = await db
        .select({
          id: tokenTransactions.id,
          fromAddress: tokenTransactions.fromAddress,
          toAddress: tokenTransactions.toAddress,
          tokenIds: tokenTransactions.tokenIds,
          type: tokenTransactions.type,
          timestamp: tokenTransactions.timestamp,
        })
        .from(tokenTransactions)
        .orderBy(tokenTransactions.timestamp);

      this.chain = existingTransactions.map(tx => ({
        id: tx.id.toString(),
        from: tx.fromAddress || 'SYSTEM',
        to: tx.toAddress || '',
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

  async releaseEscrow(escrowTransactionId: string, toAddress: string): Promise<TransactionResult> {
    console.log('[Blockchain] Releasing escrow:', { escrowTransactionId, toAddress });

    try {
      return await db.transaction(async (tx) => {
        // Get the escrow transaction
        const escrowTx = await tx
          .select()
          .from(tokenTransactions)
          .where(eq(tokenTransactions.id, parseInt(escrowTransactionId)))
          .limit(1)
          .then(rows => rows[0]);

        if (!escrowTx) {
          throw new Error('Escrow transaction not found');
        }

        if (escrowTx.type !== 'escrow') {
          throw new Error('Invalid transaction type for escrow release');
        }

        const tokenIds = escrowTx.tokenIds || [];
        if (!tokenIds.length) {
          throw new Error('No tokens found in escrow');
        }

        console.log('[Blockchain] Found escrow tokens:', {
          count: tokenIds.length,
          tokenIds
        });

        // Update token ownership and status from ESCROW to worker
        await tx
          .update(tokens)
          .set({
            owner: toAddress,
            status: 'active',
            updated_at: new Date()
          })
          .where(
            and(
              inArray(tokens.id, tokenIds),
              eq(tokens.status, 'escrow'),
              eq(tokens.owner, 'ESCROW')
            )
          );

        // Create release transaction record
        const [releaseTx] = await tx
          .insert(tokenTransactions)
          .values({
            userId: parseInt(toAddress), // Worker's user ID
            type: 'release',
            status: 'completed',
            fromAddress: 'ESCROW',
            toAddress: toAddress,
            tokenIds: tokenIds,
            metadata: {
              escrowTransactionId,
              releaseTimestamp: new Date().toISOString()
            },
            timestamp: new Date()
          })
          .returning();

        // Add to chain
        const chainTransaction: Transaction = {
          id: releaseTx.id.toString(),
          from: 'ESCROW',
          to: toAddress,
          amount: tokenIds.length,
          timestamp: Date.now(),
          type: 'release',
          tokenIds,
          metadata: {
            escrowTransactionId,
            releaseTimestamp: new Date().toISOString()
          }
        };

        this.chain.push(chainTransaction);

        // Update balances
        await balanceTracker.invalidateCache(toAddress);
        await balanceTracker.forceSyncBalance(toAddress);

        console.log('[Blockchain] Escrow released:', {
          transactionId: releaseTx.id,
          tokenCount: tokenIds.length,
          recipient: toAddress
        });

        return {
          id: releaseTx.id.toString(),
          tokenIds,
          blockHash: 'immediate'
        };
      });
    } catch (error) {
      console.error('[Blockchain] Escrow release failed:', error);
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
        // For system transactions (minting), throw error as it's not allowed here
        // Allow transactions from SYSTEM and to ESCROW
        if (from === 'SYSTEM' && to !== 'ESCROW') {
          throw new Error('System transactions not allowed here');
        }

        // Get receiver's user ID
        const toUser = await tx
          .select()
          .from(users)
          .where(eq(users.username, to))
          .limit(1)
          .then(rows => rows[0]);

        if (!toUser) {
          throw new Error(`Recipient user not found: ${to}`);
        }

        // Get sender's user ID
        const fromUser = await tx
          .select()
          .from(users)
          .where(eq(users.username, from))
          .limit(1)
          .then(rows => rows[0]);

        if (!fromUser) {
          throw new Error(`Sender user not found: ${from}`);
        }

        // Get tokens owned by sender
        const senderTokens = await tx
          .select({
            id: tokens.id,
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

        const tokenIds = senderTokens.map(token => token.id);

        console.log('[Blockchain] Transferring tokens:', {
          from,
          to,
          tokenCount: tokenIds.length,
          tokenIds
        });

        // Update token ownership
        await tx
          .update(tokens)
          .set({
            owner: to,
            updated_at: new Date()
          })
          .where(
            and(
              inArray(tokens.id, tokenIds),
              eq(tokens.status, 'active'),
              eq(tokens.owner, from)
            )
          );

        // Create transaction record
        const [transaction] = await tx
          .insert(tokenTransactions)
          .values({
            userId: toUser.id,
            type: to === 'ESCROW' ? 'escrow' : 'transfer',
            status: 'completed',
            fromAddress: from,
            toAddress: to,
            tokenIds: tokenIds,
            metadata: {
              baseTokens: amount,
              bonusTokens: 0,
              timestamp: new Date().toISOString()
            },
            timestamp: new Date()
          })
          .returning();

        // Add to chain
        const chainTransaction: Transaction = {
          id: transaction.id.toString(),
          from,
          to,
          amount: tokenIds.length,
          timestamp: Date.now(),
          type: to === 'ESCROW' ? 'escrow' : 'transfer',
          tokenIds
        };

        this.chain.push(chainTransaction);

        // Invalidate caches
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
          createdAt: tokens.created_at
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
          createdAt: token.createdAt,
          previousTransfers: []
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
  getTokens: blockchain.getTokens.bind(blockchain),
  releaseEscrow: blockchain.releaseEscrow.bind(blockchain)
} as const;