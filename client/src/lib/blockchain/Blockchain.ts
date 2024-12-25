import { Block } from './Block';
import { Transaction, Token, TransactionResult } from './types';
import crypto from 'crypto';

export class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private tokenRegistry: Map<string, Token>;
  private readonly maxSupply: number;

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.tokenRegistry = new Map();
    this.maxSupply = 1000000; // Maximum token supply
  }

  private createGenesisBlock(): Block {
    const genesisBlock = new Block(Date.now(), [], "0");
    const genesisTokenId = crypto.randomUUID();

    // Create genesis token
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
    genesisBlock.addToken(genesisTokenId, 'GENESIS');
    genesisBlock.mineBlock();

    return genesisBlock;
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  getBlockByHash(hash: string): Block | undefined {
    return this.chain.find(block => block.hash === hash);
  }

  getBlockHashForTransaction(transactionId: string): string | undefined {
    for (const block of this.chain) {
      if (block.transactions.some(tx => tx.id === transactionId)) {
        return block.hash;
      }
    }
    return undefined;
  }

  minePendingTransactions(minerAddress: string): Block | undefined {
    if (this.tokenRegistry.size >= this.maxSupply) {
      console.log('Maximum token supply reached');
      return undefined;
    }

    const block = new Block(
      Date.now(),
      this.pendingTransactions,
      this.getLatestBlock().hash,
      0,
      this.difficulty
    );

    // Create mining reward token
    const rewardTokenId = crypto.randomUUID();
    const rewardToken: Token = {
      id: rewardTokenId,
      creator: 'SYSTEM',
      owner: minerAddress,
      metadata: {
        createdAt: new Date(),
        mintedInBlock: block.hash,
        previousTransfers: []
      }
    };

    // Add token to registry and block
    this.tokenRegistry.set(rewardTokenId, rewardToken);
    block.addToken(rewardTokenId, minerAddress);

    // Create reward transaction
    const rewardTx: Transaction = {
      id: crypto.randomUUID(),
      from: 'SYSTEM',
      to: minerAddress,
      amount: 1,
      timestamp: Date.now(),
      type: 'mint',
      tokenIds: [rewardTokenId]
    };

    block.transactions.push(rewardTx);
    block.mineBlock();

    this.chain.push(block);
    this.pendingTransactions = [];

    return block;
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
      const balance = this.getBalanceOfAddress(from);
      if (balance < amount) {
        throw new Error(`Insufficient balance: ${balance} < ${amount}`);
      }
    }

    // Generate unique IDs for tokens being transferred
    const tokenIds = Array.from({ length: amount }, () => crypto.randomUUID());

    const transaction: Transaction = {
      id: crypto.randomUUID(),
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

  getBalanceOfAddress(address: string): number {
    return Array.from(this.tokenRegistry.values())
      .filter(token => token.owner === address)
      .length;
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
  }

  getAllTransactions(): Transaction[] {
    return this.chain.reduce((acc, block) => [...acc, ...block.transactions], [] as Transaction[]);
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }
}