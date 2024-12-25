import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult, TokenMetadata } from '../../client/src/lib/blockchain/types';
import { createHash } from 'crypto';
import { db } from "@db";
import { tokens, users } from "@db/schema";
import { sql, eq, count } from 'drizzle-orm';

class Block {
  public hash: string;
  public nonce: number;
  private tokens: Map<string, Token>;

  constructor(
    public timestamp: number,
    public transactions: Transaction[],
    public previousHash: string = '',
    public difficulty: number = 4
  ) {
    this.nonce = 0;
    this.tokens = new Map<string, Token>();
    this.hash = this.calculateHash();
    console.log('Block created:', { timestamp, previousHash, difficulty });
  }

  calculateHash(): string {
    const data = this.previousHash +
      this.timestamp.toString() +
      JSON.stringify(Array.from(this.tokens.entries())) +
      JSON.stringify(this.transactions) +
      this.nonce.toString();

    return createHash('sha256').update(data).digest('hex');
  }

  mineBlock(minerAddress: string) {
    const target = Array(this.difficulty + 1).join('0');
    console.log('Mining block...', { minerAddress, difficulty: this.difficulty });

    while (this.hash.substring(0, this.difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }

    console.log('Block mined!', { hash: this.hash });

    // Only create mining reward if it's not the genesis block
    if (minerAddress !== 'GENESIS') {
      console.log('Creating mining reward for:', minerAddress);

      // Find the purchase transaction to calculate mining reward
      const purchaseTransaction = this.transactions.find(tx =>
        tx.type === 'mint' && tx.metadata?.price && !tx.metadata?.reason
      );

      if (purchaseTransaction) {
        // Calculate mining reward based on purchase amount and tier
        let bonusPercentage = 0;
        const amount = purchaseTransaction.amount;

        if (amount >= 1000) {
          bonusPercentage = 20;
        } else if (amount >= 500) {
          bonusPercentage = 10;
        }

        const bonusTokens = Math.floor(amount * (bonusPercentage / 100));
        console.log('Calculated mining reward:', { amount, bonusPercentage, bonusTokens });

        if (bonusTokens > 0) {
          // Create bonus tokens as mining rewards
          const bonusTokenIds = Array.from({ length: bonusTokens }, () => uuidv4());

          bonusTokenIds.forEach(tokenId => {
            const rewardToken: Token = {
              id: tokenId,
              creator: 'SYSTEM',
              owner: minerAddress,
              metadata: {
                createdAt: new Date(),
                mintedInBlock: this.hash,
                previousTransfers: [],
                purchaseInfo: {
                  reason: 'mining_bonus',
                  originalTransactionId: purchaseTransaction.id,
                  purchaseDate: new Date()
                }
              }
            };

            this.tokens.set(tokenId, rewardToken);
            console.log('Added bonus token:', { tokenId, owner: minerAddress });
          });

          // Create a mining reward transaction for bonus tokens
          const rewardTransaction: Transaction = {
            id: uuidv4(),
            from: 'SYSTEM',
            to: minerAddress,
            amount: bonusTokens,
            timestamp: Date.now(),
            type: 'mint',
            tokenIds: bonusTokenIds,
            metadata: {
              reason: 'mining_bonus',
              originalTransactionId: purchaseTransaction.id
            }
          };

          this.transactions.push(rewardTransaction);
          console.log('Added mining reward transaction:', rewardTransaction);
        }
      }
    }
  }

  getTokens(): Token[] {
    return Array.from(this.tokens.values());
  }
}

class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private tokenRegistry: Map<string, Token>;
  private readonly maxSupply: number;

  constructor() {
    console.log('Initializing blockchain...');
    this.chain = [];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.tokenRegistry = new Map<string, Token>();
    this.maxSupply = 1000000;
    this.createGenesisBlock();
  }

  private createGenesisBlock(): void {
    console.log('Creating genesis block...');
    const genesisBlock = new Block(Date.now(), [], '0');
    genesisBlock.mineBlock('GENESIS');
    this.chain.push(genesisBlock);

    const genesisTokens = genesisBlock.getTokens();
    console.log('Genesis block tokens:', genesisTokens);
    genesisTokens.forEach(token => {
      this.tokenRegistry.set(token.id, token);
    });
    console.log('Genesis block created, token registry size:', this.tokenRegistry.size);
  }

  getAllTransactions(): Transaction[] {
    return this.chain.reduce((acc, block) => {
      return acc.concat(block.transactions.map(tx => ({
        ...tx,
        blockHash: block.hash
      })));
    }, [] as Transaction[]);
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }

  async getBalance(address: string): Promise<number> {
    console.log('[Balance Check] Starting balance calculation for:', address);
    try {
      const result = await db
        .select({ count: count() })
        .from(tokens)
        .where(eq(tokens.owner, address));

      const tokenCount = result[0].count;
      console.log('[Balance Check] Result:', { 
        address, 
        queryResult: result,
        calculatedBalance: tokenCount,
        timestamp: new Date().toISOString()
      });
      return tokenCount;
    } catch (error) {
      console.error('[Balance Check] Error calculating balance:', {
        address,
        error,
        timestamp: new Date().toISOString()
      });
      return 0;
    }
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
  }

  async updateUserBalance(username: string): Promise<number> {
    console.log('[Balance Update] Starting balance update for:', username);
    try {
      // Get token count using Drizzle ORM
      const result = await db
        .select({ count: count() })
        .from(tokens)
        .where(eq(tokens.owner, username));

      const tokenCount = result[0].count;
      console.log('[Balance Update] Token count from database:', {
        username,
        tokenCount,
        queryResult: result,
        timestamp: new Date().toISOString()
      });

      // Update user's token balance
      const [updatedUser] = await db
        .update(users)
        .set({
          tokenBalance: tokenCount,
          updated_at: new Date()
        })
        .where(eq(users.username, username))
        .returning();

      console.log('[Balance Update] User balance updated:', {
        username,
        previousCount: tokenCount,
        newBalance: updatedUser.tokenBalance,
        timestamp: new Date().toISOString()
      });

      return tokenCount;
    } catch (error) {
      console.error('[Balance Update] Error updating user balance:', {
        username,
        error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async createTransaction(from: string, to: string, amount: number, metadata?: { paymentId?: string; price?: number; bonusTokens?: number }): Promise<TransactionResult> {
    console.log('Creating transaction:', { from, to, amount, metadata });

    if (!from || !to) {
      throw new Error('Transaction must include from and to addresses');
    }

    if (amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    // Check balance (except for system transactions)
    if (from !== 'SYSTEM') {
      const balance = await this.getBalance(from);
      console.log('Checking balance:', { address: from, balance, required: amount });
      if (balance < amount) {
        throw new Error(`Insufficient balance: ${balance} < ${amount}`);
      }
    }

    // First create the base transaction for purchased tokens
    const baseTokenIds = Array.from({ length: amount }, () => uuidv4());
    console.log('Generated token IDs for base purchase:', baseTokenIds);

    const baseTransaction: Transaction = {
      id: uuidv4(),
      from,
      to,
      amount,
      timestamp: Date.now(),
      type: from === 'SYSTEM' ? 'mint' : 'transfer',
      tokenIds: baseTokenIds,
      metadata
    };

    this.pendingTransactions.push(baseTransaction);
    console.log('Added base transaction to pending:', baseTransaction);

    // If bonus tokens are specified, create a separate mining reward transaction
    let bonusTokenIds: string[] = [];
    if (metadata?.bonusTokens && metadata.bonusTokens > 0) {
      bonusTokenIds = Array.from({ length: metadata.bonusTokens }, () => uuidv4());
      console.log('Generated token IDs for bonus rewards:', bonusTokenIds);

      const bonusTransaction: Transaction = {
        id: uuidv4(),
        from: 'SYSTEM',
        to,
        amount: metadata.bonusTokens,
        timestamp: Date.now(),
        type: 'mint',
        tokenIds: bonusTokenIds,
        metadata: {
          ...metadata,
          reason: 'volume_bonus',
          originalTransactionId: baseTransaction.id
        }
      };

      this.pendingTransactions.push(bonusTransaction);
      console.log('Added bonus transaction to pending:', bonusTransaction);
    }

    // Mine block immediately for simplicity
    const block = await this.minePendingTransactions(to);
    if (!block) {
      throw new Error('Failed to mine block');
    }

    try {
      // Create base purchased tokens in database
      const baseTokensToCreate = baseTokenIds.map(tokenId => ({
        id: tokenId,
        creator: from,
        owner: to,
        mintedInBlock: block.hash,
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

      await db.insert(tokens).values(baseTokensToCreate);
      console.log('Created base purchased tokens in database:', baseTokensToCreate.length);

      // Add base tokens to registry
      baseTokensToCreate.forEach(token => {
        this.tokenRegistry.set(token.id, token as Token);
        console.log('Added purchased token to registry:', { id: token.id, owner: token.owner });
      });

      // Create bonus tokens if specified
      if (bonusTokenIds.length > 0) {
        const bonusTokensToCreate = bonusTokenIds.map(tokenId => ({
          id: tokenId,
          creator: 'SYSTEM',
          owner: to,
          mintedInBlock: block.hash,
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

        await db.insert(tokens).values(bonusTokensToCreate);
        console.log('Created bonus tokens in database:', bonusTokensToCreate.length);

        // Add bonus tokens to registry
        bonusTokensToCreate.forEach(token => {
          this.tokenRegistry.set(token.id, token as Token);
          console.log('Added bonus token to registry:', { id: token.id, owner: token.owner });
        });
      }

      // Combine all token IDs for the result
      const allTokenIds = [...baseTokenIds, ...bonusTokenIds];

      // Update user balance after all tokens are created
      await this.updateUserBalance(to);
      if (from !== 'SYSTEM') {
        await this.updateUserBalance(from);
      }

      const result = {
        id: baseTransaction.id,
        tokenIds: allTokenIds,
        blockHash: block.hash
      };

      console.log('Transaction completed successfully:', {
        id: result.id,
        baseTokens: baseTokenIds.length,
        bonusTokens: bonusTokenIds.length,
        blockHash: result.blockHash
      });

      return result;

    } catch (error) {
      console.error('Error creating tokens in database:', error);
      throw error;
    }
  }

  private async minePendingTransactions(minerAddress: string): Promise<Block | undefined> {
    console.log('Mining pending transactions for:', minerAddress);
    if (this.tokenRegistry.size >= this.maxSupply) {
      console.log('Maximum token supply reached');
      return undefined;
    }

    const block = new Block(
      Date.now(),
      this.pendingTransactions,
      this.chain[this.chain.length - 1].hash,
      this.difficulty
    );

    block.mineBlock(minerAddress);

    // Add new tokens to global registry
    const blockTokens = block.getTokens();
    console.log('New block tokens:', blockTokens);
    blockTokens.forEach(token => {
      this.tokenRegistry.set(token.id, token);
      console.log('Added token to registry:', { id: token.id, owner: token.owner });
    });

    this.chain.push(block);
    this.pendingTransactions = [];
    console.log('Block added to chain, new chain length:', this.chain.length);

    return block;
  }
}

// Create singleton instance
console.log('Creating blockchain service singleton...');
const blockchain = new Blockchain();

export const blockchainService = {
  createTransaction: (from: string, to: string, amount: number, metadata?: { paymentId?: string; price?: number; bonusTokens?: number }) =>
    blockchain.createTransaction(from, to, amount, metadata),
  getAllTransactions: () => blockchain.getAllTransactions(),
  getPendingTransactions: () => blockchain.getPendingTransactions(),
  getBalance: (address: string) => blockchain.getBalance(address),
  getTokenMetadata: (tokenId: string) => blockchain.getTokenMetadata(tokenId)
};