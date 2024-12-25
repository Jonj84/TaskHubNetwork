import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Transaction } from '../lib/blockchain/types';
import { blockchainService } from '../lib/blockchain/BlockchainService';
import { useToast } from './use-toast';
import { useUser } from './use-user';

export function useBlockchain() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: ['/api/blockchain/transactions'],
    queryFn: () => blockchainService.getAllTransactions(),
    staleTime: 10000, // Consider data fresh for 10 seconds
  });

  const { data: pendingTransactions = [] } = useQuery<Transaction[]>({
    queryKey: ['/api/blockchain/pending'],
    queryFn: () => blockchainService.getPendingTransactions(),
    staleTime: 5000, // Consider data fresh for 5 seconds
  });

  const { data: balance = 0, isLoading: balanceLoading } = useQuery<number>({
    queryKey: ['/api/blockchain/balance', user?.username],
    queryFn: () => {
      if (!user?.username) return Promise.resolve(0);
      return blockchainService.getBalance(user.username);
    },
    enabled: !!user?.username,
    staleTime: 5000,
  });

  const createTransactionMutation = useMutation({
    mutationFn: async ({ to, amount }: { to: string; amount: number }) => {
      if (!user) throw new Error("Must be logged in");

      try {
        await blockchainService.createTransaction(to, amount);
        return true;
      } catch (error: any) {
        toast({
          variant: 'destructive',
          title: 'Transaction Failed',
          description: error.message,
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain/balance'] });
      toast({
        title: 'Success',
        description: 'Transaction created successfully',
      });
    },
  });

  return {
    transactions,
    pendingTransactions,
    balance,
    isLoading: transactionsLoading || balanceLoading,
    createTransaction: createTransactionMutation.mutateAsync,
  };
}