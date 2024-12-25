import CryptoJS from 'crypto-js';
import { Transaction, BlockMetadata } from './types';

export class Block {
  public hash: string;
  private tokens: Map<string, string>; // tokenId -> ownerAddress

  constructor(
    public timestamp: number,
    public transactions: Transaction[],
    public previousHash: string,
    public nonce: number = 0,
    public difficulty: number = 4
  ) {
    this.tokens = new Map();
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

  mineBlock(): void {
    const target = Array(this.difficulty + 1).join("0");
    while (this.hash.substring(0, this.difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }

    console.log('Block mined:', this.hash);
  }

  addToken(tokenId: string, ownerAddress: string): void {
    this.tokens.set(tokenId, ownerAddress);
  }

  getTokenOwner(tokenId: string): string | undefined {
    return this.tokens.get(tokenId);
  }

  getAllTokens(): Array<[string, string]> {
    return Array.from(this.tokens.entries());
  }

  hasValidTransactions(): boolean {
    return this.transactions.every(tx => this.verifyTransaction(tx));
  }

  getMetadata(): BlockMetadata {
    return {
      hash: this.hash,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      nonce: this.nonce,
      difficulty: this.difficulty
    };
  }

  private verifyTransaction(transaction: Transaction): boolean {
    // For now, we'll consider all transactions valid
    // In a real implementation, we would verify signatures here
    return true;
  }
}