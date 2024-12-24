import CryptoJS from 'crypto-js';

export interface Transaction {
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  signature?: string;
}

export class Block {
  public hash: string;

  constructor(
    public timestamp: number,
    public transactions: Transaction[],
    public previousHash: string,
    public nonce: number = 0
  ) {
    this.hash = this.calculateHash();
  }

  calculateHash(): string {
    return CryptoJS.SHA256(
      this.previousHash +
      this.timestamp +
      JSON.stringify(this.transactions) +
      this.nonce
    ).toString();
  }

  mineBlock(difficulty: number): void {
    while (
      this.hash.substring(0, difficulty) !== Array(difficulty + 1).join("0")
    ) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }

  hasValidTransactions(): boolean {
    for (const tx of this.transactions) {
      if (!this.verifyTransaction(tx)) {
        return false;
      }
    }
    return true;
  }

  private verifyTransaction(transaction: Transaction): boolean {
    if (!transaction.signature) {
      return false;
    }

    // Simple validation for now - we'll add proper signature verification later
    return true;
  }
}