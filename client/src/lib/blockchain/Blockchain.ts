import { v4 as uuidv4 } from 'uuid';
import { Block } from './Block';
import { Transaction, Token, TransactionResult } from './types';

export class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private tokenRegistry: Map<string, Token>;
  private readonly maxSupply: number;

  constructor() {
    console.log('Initializing client blockchain...');
    this.chain = [];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.tokenRegistry = new Map<string, Token>();
    this.maxSupply = 1000000; // Maximum token supply
    this.createGenesisBlock(); // Initialize genesis block
  }

  private createGenesisBlock(): void {
    console.log('Creating genesis block...');
    const genesisBlock = new Block(Date.now(), [], "0");
    const genesisTokenId = uuidv4();

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

    // Add token to registry
    this.tokenRegistry.set(genesisTokenId, genesisToken);
    genesisBlock.addToken(genesisTokenId, 'GENESIS');
    genesisBlock.mineBlock();
    console.log('Genesis block created with token:', genesisTokenId);

    this.chain.push(genesisBlock);
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
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
    const balance = Array.from(this.tokenRegistry.values())
      .filter(token => token.owner === address)
      .length;
    console.log('Getting balance for:', address, 'Balance:', balance);
    return balance;
  }

  createTransaction(from: string, to: string, amount: number): TransactionResult {
    console.log('Creating transaction:', { from, to, amount });
    if (!from || !to) {
      throw new Error('Transaction must include from and to addresses');
    }

    if (amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    // Check balance (except for system transactions)
    if (from !== 'SYSTEM') {
      const balance = this.getBalance(from);
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
      tokenIds
    };

    this.pendingTransactions.push(transaction);
    console.log('Added transaction to pending:', transaction);

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
        console.log('Updated token ownership:', { tokenId, newOwner: to });
      }
    });

    const result = {
      id: transaction.id,
      tokenIds,
      blockHash: block.hash
    };
    console.log('Transaction completed:', result);
    return result;
  }

  private minePendingTransactions(minerAddress: string): Block | undefined {
    console.log('Mining pending transactions for:', minerAddress);
    if (this.tokenRegistry.size >= this.maxSupply) {
      console.log('Maximum token supply reached');
      return undefined;
    }

    const block = new Block(
      Date.now(),
      this.pendingTransactions,
      this.getLatestBlock().hash,
      this.difficulty
    );

    // Create mining reward token
    const rewardTokenId = uuidv4();
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
    console.log('Created mining reward token:', rewardTokenId);

    const rewardTransaction: Transaction = {
      id: uuidv4(),
      from: 'SYSTEM',
      to: minerAddress,
      amount: 1,
      timestamp: Date.now(),
      type: 'mint',
      tokenIds: [rewardTokenId]
    };

    block.transactions.push(rewardTransaction);
    block.mineBlock();

    this.chain.push(block);
    this.pendingTransactions = [];
    console.log('Block added to chain, new chain length:', this.chain.length);

    return block;
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
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
    const rewardTokenId = uuidv4();
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
      id: uuidv4(),
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

  getBalanceOfAddress(address: string): number {
    return Array.from(this.tokenRegistry.values())
      .filter(token => token.owner === address)
      .length;
  }
}