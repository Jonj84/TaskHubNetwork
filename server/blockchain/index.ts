import crypto from 'crypto';

export interface Transaction {
  from: string;
  to: string;
  amount: number;
  timestamp: Date;
  id?: string;
}

class Block {
  public hash: string;
  public nonce: number = 0;

  constructor(
    public timestamp: Date,
    public transactions: Transaction[],
    public previousHash: string = ''
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

  mineBlock(difficulty: number) {
    while (
      this.hash.substring(0, difficulty) !== Array(difficulty + 1).join('0')
    ) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }
}

class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 2;
    this.pendingTransactions = [];
  }

  private createGenesisBlock(): Block {
    return new Block(new Date(), [], '0');
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  minePendingTransactions() {
    const block = new Block(
      new Date(),
      this.pendingTransactions,
      this.getLatestBlock().hash
    );

    block.mineBlock(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];
  }

  createTransaction(from: string, to: string, amount: number): Transaction {
    const transaction: Transaction = {
      from,
      to,
      amount,
      timestamp: new Date(),
      id: crypto.randomUUID()
    };

    this.pendingTransactions.push(transaction);
    this.minePendingTransactions(); // Mine immediately for simplicity
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
  getBalance: (address: string) => blockchain.getBalance(address)
};
