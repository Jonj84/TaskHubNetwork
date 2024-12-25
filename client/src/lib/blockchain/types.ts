export interface TokenMetadata {
  createdAt: Date;
  mintedInBlock: string;
  previousTransfers: Array<{
    id: string;
    from: string;
    to: string;
    timestamp: number;
    transactionId: string;
  }>;
  purchaseInfo?: {
    paymentId?: string;
    price?: number;
    purchaseDate: Date;
  };
}

export interface Token {
  id: string;
  creator: string;
  owner: string;
  metadata: TokenMetadata;
}

export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: 'mint' | 'transfer' | 'escrow' | 'release';
  tokenIds: string[];
  blockHash?: string;
  metadata?: {
    paymentId?: string;
    price?: number;
    reason?: string;
    escrowTransactionId?: string;
    releaseTimestamp?: string;
  };
}

export interface BlockMetadata {
  hash: string;
  previousHash: string;
  timestamp: number;
  nonce: number;
  difficulty: number;
}

export interface TransactionResult {
  id: string;
  tokenIds: string[];
  blockHash: string;
}