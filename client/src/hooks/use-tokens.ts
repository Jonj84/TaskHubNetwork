import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export interface TokenTransaction {
  id: number;
  amount: number;
  type: 'purchase' | 'spend';
  timestamp: string;
}

export function useTokens() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const purchaseTokensMutation = useMutation({
    mutationFn: async (amount: number) => {
      const response = await fetch('/api/tokens/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      toast({
        title: 'Success',
        description: `Successfully purchased tokens. New balance: ${data.newBalance}`,
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Purchase Failed',
        description: error.message,
      });
    }
  });

  const { data: transactions, isLoading } = useQuery<TokenTransaction[]>({
    queryKey: ['/api/tokens/history'],
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  return {
    transactions,
    isLoading,
    purchaseTokens: purchaseTokensMutation.mutateAsync,
  };
}