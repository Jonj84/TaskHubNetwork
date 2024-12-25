import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';

// Token represents a unique token in the blockchain
interface Token {
  id: string;
  creator: string;
  owner: string;
  metadata: {
    createdAt: Date;
    mintedInBlock: string; // Hash of the block where token was minted
    previousTransfers: string[]; // Array of transaction IDs that transferred this token
  };
}

class Block {
  public hash: string;
  public nonce: number;
  private miningReward: number;
  public tokens: Map<string, Token>;

  constructor(
    public timestamp: number,
    public transactions: Transaction[],
    public previousHash: string = '',
    public difficulty: number = 4
  ) {
    this.nonce = 0;
    this.miningReward = 1; // Reward is now 1 unique token
    this.tokens = new Map<string, Token>();
    this.hash = this.calculateHash();
  }

  calculateHash(): string {
    const tokenEntries = Array.from(this.tokens.entries());
    return crypto
      .createHash('sha256')
      .update(
        this.previousHash +
          this.timestamp.toString() +
          JSON.stringify(tokenEntries) +
          JSON.stringify(this.transactions) +
          this.nonce.toString()
      )
      .digest('hex');
  }

  mineBlock(minerAddress: string) {
    const target = Array(this.difficulty + 1).join('0');
    console.log('Mining block...', { minerAddress, difficulty: this.difficulty });

    while (this.hash.substring(0, this.difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }

    // Create a new token as mining reward
    const rewardTokenId = uuidv4();
    const rewardToken: Token = {
      id: rewardTokenId,
      creator: 'SYSTEM',
      owner: minerAddress,
      metadata: {
        createdAt: new Date(),
        mintedInBlock: this.hash,
        previousTransfers: []
      }
    };

    // Add token to block's token map
    this.tokens.set(rewardTokenId, rewardToken);

    // Create reward transaction
    const rewardTransaction: Transaction = {
      id: uuidv4(),
      from: 'SYSTEM',
      to: minerAddress,
      amount: 1,
      timestamp: Date.now(),
      type: 'mint',
      tokenIds: [rewardTokenId]
    };

    this.transactions.push(rewardTransaction);
    console.log('Block mined!', { hash: this.hash.substring(0, 10), rewardToken: rewardTokenId });
  }
}

class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private tokenRegistry: Map<string, Token>;
  private readonly maxSupply: number;

  constructor() {
    this.chain = [];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.tokenRegistry = new Map<string, Token>();
    this.maxSupply = 1000000;
    this.chain.push(this.createGenesisBlock());
  }

  private createGenesisBlock(): Block {
    const genesisBlock = new Block(Date.now(), [], '0');
    const genesisTokenId = uuidv4();
    const genesisToken: Token = {
      id: genesisTokenId,
      creator: 'SYSTEM',
      owner: 'GENESIS',
      metadata: {
        createdAt: new Date(),
        mintedInBlock: genesisBlock.hash,
        previousTransfers: []
      }
    };

    this.tokenRegistry.set(genesisTokenId, genesisToken);
    genesisBlock.tokens.set(genesisTokenId, genesisToken);
    genesisBlock.mineBlock('GENESIS');

    return genesisBlock;
  }

  createTransaction(from: string, to: string, amount: number): TransactionResult {
    if (!from || !to) {
      throw new Error('Transaction must include from and to addresses');
    }

    if (amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    // Check balance (except for system transactions)
    if (from !== 'SYSTEM') {
      const balance = this.getBalance(from);
      if (balance < amount) {
        throw new Error(`Insufficient balance: ${balance} < ${amount}`);
      }
    }

    // Generate unique IDs for tokens being transferred
    const tokenIds = Array.from({ length: amount }, () => uuidv4());

    const transaction: Transaction = {
      id: uuidv4(),
      from,
      to,
      amount,
      timestamp: Date.now(),
      type: from === 'SYSTEM' ? 'mint' : 'transfer',
      tokenIds
    };

    // Add transaction to pending
    this.pendingTransactions.push(transaction);

    // Mine block immediately for simplicity
    const block = this.minePendingTransactions(to);
    if (!block) {
      throw new Error('Failed to mine block');
    }

    // Update token ownership
    tokenIds.forEach(tokenId => {
      const token = this.tokenRegistry.get(tokenId);
      if (token) {
        token.owner = to;
        token.metadata.previousTransfers.push(transaction.id);
      }
    });

    return {
      id: transaction.id,
      tokenIds,
      blockHash: block.hash
    };
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

  getBalance(address: string): number {
    return Array.from(this.tokenRegistry.values())
      .filter(token => token.owner === address)
      .length;
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
  }

  private minePendingTransactions(minerAddress: string): Block | undefined {
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
    this.chain.push(block);
    this.pendingTransactions = [];

    // Add new tokens to global registry
    block.tokens.forEach((token, id) => {
      this.tokenRegistry.set(id, token);
    });

    return block;
  }
}

// Create singleton instance
const blockchain = new Blockchain();

export const blockchainService = {
  createTransaction: (from: string, to: string, amount: number) =>
    blockchain.createTransaction(from, to, amount),
  getAllTransactions: () => blockchain.getAllTransactions(),
  getPendingTransactions: () => blockchain.getPendingTransactions(),
  getBalance: (address: string) => blockchain.getBalance(address),
  getTokenMetadata: (tokenId: string) => blockchain.getTokenMetadata(tokenId)
};