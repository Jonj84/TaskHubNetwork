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
import { logErrorToServer } from '@/lib/errorLogging';

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
      try {
        // Create checkout session
        const response = await fetch('/api/tokens/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ amount }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const { checkoutUrl } = await response.json();
        if (!checkoutUrl) {
          throw new Error('No checkout URL received');
        }

        // Open Stripe checkout in a popup window
        const popupWidth = 450;
        const popupHeight = 650;
        const left = (window.screen.width / 2) - (popupWidth / 2);
        const top = (window.screen.height / 2) - (popupHeight / 2);

        const popup = window.open(
          checkoutUrl,
          'Stripe Checkout',
          `width=${popupWidth},height=${popupHeight},left=${left},top=${top}`
        );

        if (!popup) {
          throw new Error('Popup was blocked. Please allow popups and try again.');
        }

        // Monitor popup status
        const checkPopup = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopup);
            // User might have completed payment or cancelled
            // The success/cancel pages will handle the status
            queryClient.invalidateQueries({ queryKey: ['/api/user'] });
          }
        }, 500);

        return { success: true };
      } catch (error: any) {
        await logErrorToServer(error, 'stripe_checkout_failed');
        throw error;
      }
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Purchase Failed',
        description: error.message || 'Failed to initiate purchase',
      });
    },
    onSuccess: () => {
      setOpen(false);
      toast({
        title: 'Checkout Started',
        description: 'Please complete your purchase in the popup window',
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