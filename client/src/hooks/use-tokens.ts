import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TokenTransaction } from '../types';

export function useTokens() {
  const queryClient = useQueryClient();

  const { data: transactions = [] } = useQuery<TokenTransaction[]>({
    queryKey: ['/api/tokens/transactions'],
  });

  const purchaseTokensMutation = useMutation({
    mutationFn: async (amount: number) => {
      const response = await fetch('/api/tokens/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount }),
      });
      
      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tokens/transactions'] });
    },
  });

  return {
    transactions,
    purchaseTokens: purchaseTokensMutation.mutateAsync,
  };
}
