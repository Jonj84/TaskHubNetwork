import { Block, Transaction } from './Block';

export class Blockchain {
  private chain: Block[];
  private difficulty: number;
  private pendingTransactions: Transaction[];
  private miningReward: number;

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 2;
    this.pendingTransactions = [];
    this.miningReward = 10;
  }

  private createGenesisBlock(): Block {
    return new Block(Date.now(), [], "0");
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  minePendingTransactions(miningRewardAddress: string): void {
    // Create mining reward transaction
    const rewardTx: Transaction = {
      from: "network",
      to: miningRewardAddress,
      amount: this.miningReward,
      timestamp: Date.now(),
    };

    this.pendingTransactions.push(rewardTx);

    // Create new block with all pending transactions
    const block = new Block(
      Date.now(),
      this.pendingTransactions,
      this.getLatestBlock().hash
    );

    // Mine the block
    block.mineBlock(this.difficulty);

    // Add block to chain
    this.chain.push(block);

    // Reset pending transactions, except new ones that may have come in during mining
    this.pendingTransactions = [];
  }

  addTransaction(transaction: Transaction): void {
    if (!transaction.from || !transaction.to) {
      throw new Error('Transaction must include from and to addresses');
    }

    if (transaction.amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    const balance = this.getBalanceOfAddress(transaction.from);
    if (balance < transaction.amount) {
      throw new Error('Not enough balance');
    }

    this.pendingTransactions.push(transaction);
  }

  getBalanceOfAddress(address: string): number {
    let balance = 0;

    for (const block of this.chain) {
      for (const trans of block.transactions) {
        if (trans.from === address) {
          balance -= trans.amount;
        }
        if (trans.to === address) {
          balance += trans.amount;
        }
      }
    }

    return balance;
  }

  isChainValid(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Verify block's hash
      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }

      // Verify block chain
      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }

      // Verify transactions in block
      if (!currentBlock.hasValidTransactions()) {
        return false;
      }
    }
    return true;
  }

  getAllTransactions(): Transaction[] {
    const transactions: Transaction[] = [];
    for (const block of this.chain) {
      transactions.push(...block.transactions);
    }
    return transactions;
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }
}
