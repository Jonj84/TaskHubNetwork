import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Transaction } from '../lib/blockchain/Block';
import { blockchainService } from '../lib/blockchain/BlockchainService';
import { useToast } from './use-toast';
import { useUser } from './use-user';

export function useBlockchain() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['/api/blockchain/transactions'],
    queryFn: () => blockchainService.getAllTransactions(),
    staleTime: 10000, // Consider data fresh for 10 seconds
  });

  const { data: pendingTransactions = [] } = useQuery<Transaction[]>({
    queryKey: ['/api/blockchain/pending'],
    queryFn: () => blockchainService.getPendingTransactions(),
    staleTime: 5000, // Consider data fresh for 5 seconds
  });

  const createTransactionMutation = useMutation({
    mutationFn: async ({ to, amount }: { to: string; amount: number }) => {
      if (!user) throw new Error("Must be logged in");
      
      try {
        blockchainService.createTransaction(
          user.username, // Using username as the wallet address for now
          to,
          amount
        );
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
      toast({
        title: 'Success',
        description: 'Transaction created successfully',
      });
    },
  });

  const getBalance = (address: string) => {
    return blockchainService.getBalance(address);
  };

  return {
    transactions,
    pendingTransactions,
    isLoading,
    createTransaction: createTransactionMutation.mutateAsync,
    getBalance,
  };
}
