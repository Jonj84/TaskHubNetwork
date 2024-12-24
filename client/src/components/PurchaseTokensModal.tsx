import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BlockchainLoader } from './BlockchainLoader';

const purchaseSchema = z.object({
  amount: z.number()
    .min(1, 'Minimum purchase is 1 token')
    .max(1000, 'Maximum purchase is 1000 tokens'),
});

type PurchaseFormData = z.infer<typeof purchaseSchema>;

export default function PurchaseTokensModal() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<PurchaseFormData>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      amount: 10,
    },
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
      setOpen(false);
      toast({
        title: 'Success',
        description: 'Tokens purchased successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to purchase tokens',
      });
    },
  });

  const onSubmit = (data: PurchaseFormData) => {
    purchaseTokensMutation.mutate(data.amount);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Purchase Tokens</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Purchase Tokens</DialogTitle>
          <DialogDescription>
            Enter the amount of tokens you want to purchase.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex flex-col items-center gap-4">
              {purchaseTokensMutation.isPending ? (
                <div className="py-2">
                  <BlockchainLoader size="sm" />
                </div>
              ) : null}
              <Button 
                type="submit" 
                className="w-full"
                disabled={purchaseTokensMutation.isPending}
              >
                {purchaseTokensMutation.isPending ? 'Processing...' : 'Purchase'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}