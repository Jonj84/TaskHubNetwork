import { v4 as uuidv4 } from 'uuid';
import type { Transaction, Token, TransactionResult } from '../../client/src/lib/blockchain/types';
import { createHash } from 'crypto';

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
          previousTransfers: []
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
        tokenIds: [rewardTokenId]
      };

      this.transactions.push(rewardTransaction);
      console.log('Added reward transaction:', rewardTransaction);
    }
  }

  getTokens(): Map<string, Token> {
    return this.tokens;
  }
}

class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private tokenRegistry: Map<string, Token>;
  private readonly maxSupply: number;
  private balances: Map<string, number>;

  constructor() {
    console.log('Initializing blockchain...');
    this.chain = [];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.tokenRegistry = new Map<string, Token>();
    this.balances = new Map<string, number>();
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
    console.log('Genesis block tokens:', Array.from(genesisTokens.entries()));
    genesisTokens.forEach((token, id) => {
      this.tokenRegistry.set(id, token);
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

  getBalance(address: string): number {
    if (!this.balances.has(address)) {
      // Initialize balance if not exists
      const balance = Array.from(this.tokenRegistry.values())
        .filter(token => token.owner === address)
        .length;
      this.balances.set(address, balance);
      console.log('Initialized balance for:', address, 'Balance:', balance);
    }
    const balance = this.balances.get(address) || 0;
    console.log('Getting balance for:', address, 'Balance:', balance);
    return balance;
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
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

    // Update token registry and balances
    tokenIds.forEach(tokenId => {
      const token: Token = {
        id: tokenId,
        creator: from,
        owner: to,
        metadata: {
          createdAt: new Date(),
          mintedInBlock: block.hash,
          previousTransfers: []
        }
      };
      this.tokenRegistry.set(tokenId, token);

      // Update balances
      if (from !== 'SYSTEM') {
        const fromBalance = this.getBalance(from);
        this.balances.set(from, fromBalance - 1);
      }
      const toBalance = this.getBalance(to);
      this.balances.set(to, toBalance + 1);
    });

    console.log('Updated balances:', {
      from: from !== 'SYSTEM' ? this.getBalance(from) : 'N/A',
      to: this.getBalance(to)
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
      this.chain[this.chain.length - 1].hash,
      this.difficulty
    );

    block.mineBlock(minerAddress);

    // Add new tokens to global registry and update balances
    const blockTokens = block.getTokens();
    console.log('New block tokens:', Array.from(blockTokens.entries()));
    blockTokens.forEach((token, id) => {
      this.tokenRegistry.set(id, token);
      // Update balance for mining rewards
      const ownerBalance = this.getBalance(token.owner);
      this.balances.set(token.owner, ownerBalance + 1);
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
  createTransaction: (from: string, to: string, amount: number) =>
    blockchain.createTransaction(from, to, amount),
  getAllTransactions: () => blockchain.getAllTransactions(),
  getPendingTransactions: () => blockchain.getPendingTransactions(),
  getBalance: (address: string) => blockchain.getBalance(address),
  getTokenMetadata: (tokenId: string) => blockchain.getTokenMetadata(tokenId)
};