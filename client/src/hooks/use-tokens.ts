import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TokenTransaction } from '../types';
import { cosmosClient } from '../lib/cosmos';
import { useToast } from '@/hooks/use-toast';

export function useTokens() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: transactions = [], isLoading } = useQuery<TokenTransaction[]>({
    queryKey: ['/api/tokens/transactions'],
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  const purchaseTokensMutation = useMutation({
    mutationFn: async (amount: number) => {
      try {
        // First purchase tokens through Cosmos SDK
        const result = await cosmosClient.purchaseTokens(amount);

        // Then record the transaction in our backend
        const response = await fetch('/api/tokens/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ amount, txHash: result.transactionHash }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return response.json();
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
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tokens/transactions'] });
      toast({
        title: 'Success',
        description: 'Tokens purchased successfully',
      });
    },
  });

  return {
    transactions,
    isLoading,
    purchaseTokens: purchaseTokensMutation.mutateAsync,
  };
}