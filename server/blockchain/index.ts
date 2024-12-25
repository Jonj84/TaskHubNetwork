import crypto from 'crypto';

export interface Transaction {
  from: string;
  to: string;
  amount: number;
  timestamp: Date;
  id?: string;
  type: 'mint' | 'transfer';  // Add type to distinguish between minted and transferred tokens
}

class Block {
  public hash: string;
  public nonce: number = 0;
  private miningReward: number = 50; // Mining reward for creating a new block

  constructor(
    public timestamp: Date,
    public transactions: Transaction[],
    public previousHash: string = '',
    public difficulty: number = 4
  ) {
    this.hash = this.calculateHash();
  }

  calculateHash(): string {
    return crypto
      .createHash('sha256')
      .update(
        this.previousHash +
        this.timestamp.getTime().toString() +
        JSON.stringify(this.transactions) +
        this.nonce.toString()
      )
      .digest('hex');
  }

  mineBlock(minerAddress: string) {
    const target = Array(this.difficulty + 1).join('0');

    while (this.hash.substring(0, this.difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }

    // Add mining reward transaction
    const rewardTransaction: Transaction = {
      from: 'SYSTEM',
      to: minerAddress,
      amount: this.miningReward,
      timestamp: new Date(),
      id: crypto.randomUUID(),
      type: 'mint'
    };

    this.transactions.push(rewardTransaction);
    console.log(`Block mined! Reward sent to ${minerAddress}`);
  }
}

class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private totalSupply: number;
  private readonly maxSupply: number;

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.totalSupply = 0;
    this.maxSupply = 1000000; // Maximum token supply
  }

  private createGenesisBlock(): Block {
    const genesisTransaction: Transaction = {
      from: 'SYSTEM',
      to: 'GENESIS',
      amount: 0,
      timestamp: new Date(),
      id: crypto.randomUUID(),
      type: 'mint'
    };
    return new Block(new Date(), [genesisTransaction], '0');
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  minePendingTransactions(minerAddress: string) {
    // Check if we've reached max supply
    if (this.totalSupply >= this.maxSupply) {
      console.log('Maximum token supply reached. No more tokens can be minted.');
      return;
    }

    const block = new Block(
      new Date(),
      this.pendingTransactions,
      this.getLatestBlock().hash,
      this.difficulty
    );

    console.log('Mining new block...');
    block.mineBlock(minerAddress);

    // Update total supply with mining reward
    this.totalSupply += block.transactions
      .filter(tx => tx.type === 'mint')
      .reduce((sum, tx) => sum + tx.amount, 0);

    console.log('Block added to chain:', {
      timestamp: block.timestamp,
      transactions: block.transactions.length,
      hash: block.hash,
      totalSupply: this.totalSupply
    });

    this.chain.push(block);
    this.pendingTransactions = [];
  }

  createTransaction(from: string, to: string, amount: number): Transaction {
    // Validate transaction
    if (from !== 'SYSTEM') { // Skip balance check for system transactions (minting)
      const balance = this.getBalance(from);
      if (balance < amount) {
        throw new Error(`Insufficient balance. Current balance: ${balance}, Attempted to send: ${amount}`);
      }
    }

    const transaction: Transaction = {
      from,
      to,
      amount,
      timestamp: new Date(),
      id: crypto.randomUUID(),
      type: from === 'SYSTEM' ? 'mint' : 'transfer'
    };

    this.pendingTransactions.push(transaction);
    console.log('Transaction created:', {
      id: transaction.id,
      from,
      to,
      amount,
      type: transaction.type
    });

    // Mine block immediately for simplicity
    // In a real blockchain, this would be done by miners
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
    let balance = 0;

    for (const block of this.chain) {
      for (const transaction of block.transactions) {
        if (transaction.from === address) {
          balance -= transaction.amount;
        }
        if (transaction.to === address) {
          balance += transaction.amount;
        }
      }
    }

    return balance;
  }

  getTotalSupply(): number {
    return this.totalSupply;
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
  getTotalSupply: () => blockchain.getTotalSupply()
};