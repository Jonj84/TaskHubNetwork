import { useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { BlockchainLoader } from '@/components/BlockchainLoader';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { logErrorToServer } from '@/lib/errorLogging';

// Initialize Stripe
let stripePromise: Promise<any> | null = null;
const getStripe = () => {
  if (!stripePromise && import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
    stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
  }
  return stripePromise;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientSecret?: string;
  amount: number;
}

export default function StripeCheckoutDialog({ open, onOpenChange, clientSecret, amount }: Props) {
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !clientSecret) return;

    const mountCheckout = async () => {
      try {
        const stripe = await getStripe();
        if (!stripe) {
          throw new Error('Failed to initialize Stripe');
        }

        // Create and mount the checkout
        const elements = stripe.elements({
          clientSecret,
          appearance: {
            theme: 'stripe',
          },
        });

        const checkout = elements.create('payment', {
          layout: 'tabs',
        });

        checkout.mount('#stripe-checkout-container');

        // Handle payment completion
        checkout.on('completed', async () => {
          toast({
            title: 'Payment Successful',
            description: `Successfully purchased ${amount} tokens!`,
          });
          
          // Refresh user data
          queryClient.invalidateQueries({ queryKey: ['/api/user'] });
          onOpenChange(false);
        });

        checkout.on('error', async (error: Error) => {
          await logErrorToServer(error, 'stripe_checkout_error');
          toast({
            variant: 'destructive',
            title: 'Payment Failed',
            description: error.message || 'Failed to process payment',
          });
        });

      } catch (error: any) {
        await logErrorToServer(error, 'stripe_mount_failed');
        toast({
          variant: 'destructive',
          title: 'Checkout Error',
          description: error.message || 'Failed to initialize checkout',
        });
        onOpenChange(false);
      }
    };

    mountCheckout();
  }, [open, clientSecret, amount, onOpenChange, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogTitle>Complete Purchase</DialogTitle>
        {!clientSecret ? (
          <div className="flex items-center justify-center p-8">
            <BlockchainLoader size="lg" />
          </div>
        ) : (
          <div id="stripe-checkout-container" className="min-h-[400px]" />
        )}
      </DialogContent>
    </Dialog>
  );
}
