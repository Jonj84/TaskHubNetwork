import { Transaction, Token } from './types';

class BlockchainService {
  private async fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(endpoint, {
      credentials: 'include',
      ...options
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    return response.json();
  }

  async getAllTransactions(): Promise<Transaction[]> {
    return this.fetchApi<Transaction[]>('/api/blockchain/transactions');
  }

  async getPendingTransactions(): Promise<Transaction[]> {
    return this.fetchApi<Transaction[]>('/api/blockchain/pending');
  }

  async createTransaction(from: string, to: string, amount: number): Promise<Transaction> {
    return this.fetchApi<Transaction>('/api/blockchain/transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to, amount })
    });
  }

  async getBalance(address: string): Promise<number> {
    const response = await this.fetchApi<{ balance: number }>(`/api/blockchain/balance/${address}`);
    return response.balance;
  }

  async getTokenMetadata(tokenId: string): Promise<Token | undefined> {
    try {
      return await this.fetchApi<Token>(`/api/blockchain/token/${tokenId}`);
    } catch (error) {
      console.warn(`Failed to fetch token metadata for ${tokenId}:`, error);
      return undefined;
    }
  }
}

// Export a singleton instance
export const blockchainService = new BlockchainService();
export type { Transaction, Token };