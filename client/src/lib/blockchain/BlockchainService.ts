import { Blockchain } from './Blockchain';
import { Transaction, Token } from './types';
import { WebSocket } from 'ws';

class BlockchainService {
  private blockchain: Blockchain;
  private peers: Set<WebSocket>;
  private miningInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.blockchain = new Blockchain();
    this.peers = new Set();
    this.startMining();
  }

  private startMining() {
    // Mine pending transactions every 10 seconds
    this.miningInterval = setInterval(() => {
      if (this.blockchain.getPendingTransactions().length > 0) {
        const block = this.blockchain.minePendingTransactions("network");
        if (block) {
          this.broadcastChain();
        }
      }
    }, 10000);
  }

  createTransaction(from: string, to: string, amount: number): void {
    try {
      const result = this.blockchain.createTransaction(from, to, amount);

      const transaction: Transaction = {
        id: result.id,
        from,
        to,
        amount,
        timestamp: Date.now(),
        type: from === 'SYSTEM' ? 'mint' : 'transfer',
        tokenIds: result.tokenIds,
        blockHash: result.blockHash,
      };

      this.broadcastTransaction(transaction);
    } catch (error) {
      throw error;
    }
  }

  getBalance(address: string): number {
    return this.blockchain.getBalanceOfAddress(address);
  }

  getAllTransactions(): Transaction[] {
    return this.blockchain.getAllTransactions().map(tx => ({
      ...tx,
      blockHash: this.blockchain.getBlockHashForTransaction(tx.id),
    }));
  }

  getPendingTransactions(): Transaction[] {
    return this.blockchain.getPendingTransactions();
  }

  getTokenMetadata(tokenId: string): Token | undefined {
    return this.blockchain.getTokenMetadata(tokenId);
  }

  addPeer(peer: WebSocket): void {
    this.peers.add(peer);
  }

  removePeer(peer: WebSocket): void {
    this.peers.delete(peer);
  }

  private broadcastChain(): void {
    const message = JSON.stringify({
      type: 'CHAIN_UPDATE',
      data: this.blockchain,
    });

    this.peers.forEach(peer => {
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(message);
      }
    });
  }

  private broadcastTransaction(transaction: Transaction): void {
    const message = JSON.stringify({
      type: 'NEW_TRANSACTION',
      data: transaction,
    });

    this.peers.forEach(peer => {
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(message);
      }
    });
  }

  dispose(): void {
    if (this.miningInterval) {
      clearInterval(this.miningInterval);
    }
  }
}

// Export a singleton instance
export const blockchainService = new BlockchainService();
export type { Transaction, Token };