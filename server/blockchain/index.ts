import crypto from 'crypto';

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

// Transaction now includes specific tokens being transferred
export interface Transaction {
  id: string;
  from: string;
  to: string;
  tokenIds: string[]; // Specific tokens being transferred
  timestamp: Date;
  type: 'mint' | 'transfer';
  signature?: string; // For future implementation of transaction signing
}

class Block {
  public hash: string;
  public nonce: number;
  private miningReward: number;
  public tokens: Map<string, Token>;

  constructor(
    public timestamp: Date,
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
        this.timestamp.getTime().toString() +
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
    const rewardTokenId = crypto.randomUUID();
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
      id: crypto.randomUUID(),
      from: 'SYSTEM',
      to: minerAddress,
      tokenIds: [rewardTokenId],
      timestamp: new Date(),
      type: 'mint'
    };

    this.transactions.push(rewardTransaction);
    console.log('Block mined!', {
      hash: this.hash.substring(0, 10),
      rewardToken: rewardTokenId,
      minerAddress
    });
  }
}

class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private tokenRegistry: Map<string, Token>; // Global registry of all tokens
  private readonly maxSupply: number;

  constructor() {
    this.chain = [];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.tokenRegistry = new Map();
    this.maxSupply = 1000000;
    // Create genesis block after initializing all properties
    this.chain.push(this.createGenesisBlock());
  }

  private createGenesisBlock(): Block {
    const genesisBlock = new Block(new Date(), [], '0');
    const genesisTokenId = crypto.randomUUID();
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

    genesisBlock.tokens.set(genesisTokenId, genesisToken);
    this.tokenRegistry.set(genesisTokenId, genesisToken);

    return genesisBlock;
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  minePendingTransactions(minerAddress: string) {
    if (this.tokenRegistry.size >= this.maxSupply) {
      console.log('Maximum token supply reached. No more tokens can be minted.');
      return;
    }

    const block = new Block(
      new Date(),
      this.pendingTransactions,
      this.getLatestBlock().hash,
      this.difficulty
    );

    block.mineBlock(minerAddress);

    // Add new tokens to global registry
    block.tokens.forEach((token, id) => {
      this.tokenRegistry.set(id, token);
    });

    console.log('Block added to chain:', {
      timestamp: block.timestamp,
      transactions: block.transactions.length,
      newTokens: block.tokens.size,
      totalSupply: this.tokenRegistry.size
    });

    this.chain.push(block);
    this.pendingTransactions = [];
  }

  getTokensByOwner(address: string): Token[] {
    return Array.from(this.tokenRegistry.values())
      .filter(token => token.owner === address);
  }

  createTransaction(from: string, to: string, amount: number): Transaction {
    // Get tokens owned by sender
    const senderTokens = this.getTokensByOwner(from);

    if (from !== 'SYSTEM' && senderTokens.length < amount) {
      throw new Error(`Insufficient tokens. Has: ${senderTokens.length}, Needed: ${amount}`);
    }

    // Select tokens to transfer
    const tokensToTransfer = senderTokens.slice(0, amount);
    const tokenIds = tokensToTransfer.map(token => token.id);

    const transaction: Transaction = {
      id: crypto.randomUUID(),
      from,
      to,
      tokenIds,
      timestamp: new Date(),
      type: from === 'SYSTEM' ? 'mint' : 'transfer'
    };

    // Update token ownership
    tokenIds.forEach(tokenId => {
      const token = this.tokenRegistry.get(tokenId);
      if (token) {
        token.owner = to;
        token.metadata.previousTransfers.push(transaction.id);
      }
    });

    this.pendingTransactions.push(transaction);
    console.log('Transaction created:', {
      id: transaction.id,
      from,
      to,
      tokenCount: tokenIds.length,
      type: transaction.type
    });

    // Mine block immediately for simplicity
    this.minePendingTransactions(to);
    return transaction;
  }

  getAllTransactions(): Transaction[] {
    return this.chain.reduce((transactions: Transaction[], block) => {
      return [...transactions, ...block.transactions];
    }, []);
  }

  getPendingTransactions(): Transaction[] {
    return this.pendingTransactions;
  }

  getBalance(address: string): number {
    return this.getTokensByOwner(address).length;
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.tokenRegistry.get(tokenId);
  }

  getTotalSupply(): number {
    return this.tokenRegistry.size;
  }

  isChainValid(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }
    }
    return true;
  }
}

// Create a singleton instance
const blockchain = new Blockchain();

export const blockchainService = {
  createTransaction: (from: string, to: string, amount: number) => {
    return blockchain.createTransaction(from, to, amount);
  },
  getAllTransactions: () => blockchain.getAllTransactions(),
  getPendingTransactions: () => blockchain.getPendingTransactions(),
  getBalance: (address: string) => blockchain.getBalance(address),
  getTokenMetadata: (tokenId: string) => blockchain.getTokenMetadata(tokenId),
  getTotalSupply: () => blockchain.getTotalSupply()
};