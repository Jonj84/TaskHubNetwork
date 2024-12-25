import { Transaction, Token } from './types';

class BlockchainService {
  private async fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
        ...options,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(options?.headers || {})
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Try to parse as JSON first
        try {
          const errorJson = JSON.parse(errorText);
          throw new Error(errorJson.message || errorText);
        } catch {
          throw new Error(errorText);
        }
      }

      return response.json();
    } catch (error) {
      console.error('[BlockchainService] API call failed:', error);
      throw error;
    }
  }

  async getAllTransactions(): Promise<Transaction[]> {
    return this.fetchApi<Transaction[]>('/api/blockchain/transactions');
  }

  async getPendingTransactions(): Promise<Transaction[]> {
    return this.fetchApi<Transaction[]>('/api/blockchain/pending');
  }

  async getTokens(username: string): Promise<Token[]> {
    try {
      const response = await this.fetchApi<Token[]>(`/api/blockchain/tokens/${username}`);
      console.log('[BlockchainService] Tokens fetched:', {
        username,
        count: response.length
      });
      return response;
    } catch (error) {
      console.error('[BlockchainService] Failed to fetch tokens:', error);
      return [];
    }
  }

  async createTransaction(to: string, amount: number): Promise<Transaction> {
    console.log('[BlockchainService] Creating transaction:', { to, amount });
    try {
      const response = await this.fetchApi<Transaction>('/api/blockchain/transaction', {
        method: 'POST',
        body: JSON.stringify({ to, amount })
      });
      console.log('[BlockchainService] Transaction created:', response);
      return response;
    } catch (error) {
      console.error('[BlockchainService] Transaction creation failed:', error);
      throw error;
    }
  }

  async getBalance(address: string): Promise<number> {
    try {
      const response = await this.fetchApi<{ balance: number }>(`/api/blockchain/balance/${address}`);
      console.log('[BlockchainService] Balance response:', {
        address,
        balance: response.balance
      });
      return response.balance;
    } catch (error) {
      console.error('[BlockchainService] Failed to fetch balance:', error);
      return 0;
    }
  }
}

export const blockchainService = new BlockchainService();
export type { Transaction, Token };