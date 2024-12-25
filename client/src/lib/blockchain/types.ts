export interface Token {
  id: string;
  creator: string;
  owner: string;
  metadata: {
    createdAt: Date;
    mintedInBlock: string;
    previousTransfers: string[];
  };
}

export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: 'mint' | 'transfer';
  tokenIds?: string[];
  blockHash?: string;
  signature?: string;
}

export interface TransactionResult {
  id: string;
  tokenIds: string[];
  blockHash: string;
}

export interface BlockMetadata {
  hash: string;
  previousHash: string;
  timestamp: number;
  nonce: number;
  difficulty: number;
}
