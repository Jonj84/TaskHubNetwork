import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult, TokenMetadata } from '../../client/src/lib/blockchain/types';
import { createHash } from 'crypto';
import { db } from "@db";
import { tokens } from "@db/schema";

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
      const rewardTokenId = uuidv4();
      const rewardToken: Token = {
        id: rewardTokenId,
        creator: 'SYSTEM',
        owner: minerAddress,
        metadata: {
          createdAt: new Date(),
          mintedInBlock: this.hash,
          previousTransfers: [],
        }
      };

      this.tokens.set(rewardTokenId, rewardToken);
      console.log('Added reward token:', { tokenId: rewardTokenId, owner: minerAddress });

      const rewardTransaction: Transaction = {
        id: uuidv4(),
        from: 'SYSTEM',
        to: minerAddress,
        amount: 1,
        timestamp: Date.now(),
        type: 'mint',
        tokenIds: [rewardTokenId],
        metadata: {
          reason: 'mining_reward'
        }
      };

      this.transactions.push(rewardTransaction);
      console.log('Added reward transaction:', rewardTransaction);
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

    // Add genesis block tokens to registry
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
    console.log('Calculating balance for address:', address);

    try {
      // Get token count from database
      const tokenCount = await db.query.tokens.count({
        where: (tokens, { eq }) => eq(tokens.owner, address)
      });

      console.log('Calculated balance:', { address, balance: tokenCount, totalTokens: this.tokenRegistry.size });
      return tokenCount;
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
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

    // Generate unique IDs for tokens being transferred
    const tokenIds = Array.from({ length: amount }, () => uuidv4());
    console.log('Generated token IDs:', tokenIds);

    const transaction: Transaction = {
      id: uuidv4(),
      from,
      to,
      amount,
      timestamp: Date.now(),
      type: from === 'SYSTEM' ? 'mint' : 'transfer',
      tokenIds,
      metadata
    };

    this.pendingTransactions.push(transaction);
    console.log('Added transaction to pending:', transaction);

    // Mine block immediately for simplicity
    const block = await this.minePendingTransactions(to);
    if (!block) {
      throw new Error('Failed to mine block');
    }

    // Create tokens in database
    try {
      const tokensToCreate = tokenIds.map(tokenId => ({
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

      await db.insert(tokens).values(tokensToCreate);
      console.log('Created tokens in database:', tokensToCreate);

      // If there are bonus tokens, create them as mining rewards
      if (metadata?.bonusTokens && metadata.bonusTokens > 0) {
        console.log('Creating bonus mining reward tokens:', metadata.bonusTokens);
        const bonusTokenIds = Array.from({ length: metadata.bonusTokens }, () => uuidv4());

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
              originalPurchaseId: metadata.paymentId,
              purchaseDate: new Date()
            }
          }
        }));

        await db.insert(tokens).values(bonusTokensToCreate);
        console.log('Created bonus tokens in database:', bonusTokensToCreate);

        // Add bonus tokens to registry
        bonusTokensToCreate.forEach(token => {
          this.tokenRegistry.set(token.id, token as Token);
          console.log('Added bonus token to registry:', { id: token.id, owner: token.owner });
        });

        // Add all token IDs to the result
        tokenIds.push(...bonusTokenIds);
      }

      // Update token registry with purchased tokens
      tokensToCreate.forEach(token => {
        this.tokenRegistry.set(token.id, token as Token);
        console.log('Added token to registry:', { id: token.id, owner: token.owner });
      });

    } catch (error) {
      console.error('Error creating tokens in database:', error);
      throw error;
    }

    const result = {
      id: transaction.id,
      tokenIds,
      blockHash: block.hash
    };
    console.log('Transaction completed:', result);
    return result;
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