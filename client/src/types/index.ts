export type TaskStatus = 'open' | 'in_progress' | 'pending_verification' | 'completed' | 'cancelled';
export type TaskType = 'computational' | 'manual';

export interface Task {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  reward: number;
  status: TaskStatus;
  creatorId: number;
  workerId?: number;
  proofRequired: string;
  proofSubmitted?: string;
  created_at: string;
  updated_at: string;
}

export interface TokenTransaction {
  id: number;
  userId: number;
  amount: number;
  type: 'reward' | 'purchase' | 'escrow' | 'release';
  taskId?: number;
  timestamp: string;
}

export interface User {
  id: number;
  username: string;
  tokenBalance: number;
}
