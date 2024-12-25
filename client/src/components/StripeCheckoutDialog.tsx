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

        // Create and mount the payment element
        const elements = stripe.elements({
          clientSecret,
          appearance: {
            theme: 'stripe',
          },
        });

        const paymentElement = elements.create('payment');
        paymentElement.mount('#stripe-payment-element');

        // Handle form submission
        const form = document.getElementById('payment-form');
        if (form) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const { error } = await stripe.confirmPayment({
              elements,
              confirmParams: {
                return_url: `${window.location.origin}/payment/success`,
              },
            });

            if (error) {
              await logErrorToServer(error, 'stripe_payment_error');
              toast({
                variant: 'destructive',
                title: 'Payment Failed',
                description: error.message || 'Failed to process payment',
              });
            } else {
              toast({
                title: 'Payment Successful',
                description: `Successfully purchased ${amount} tokens!`,
              });

              // Refresh user data
              queryClient.invalidateQueries({ queryKey: ['/api/user'] });
              onOpenChange(false);
            }
          });
        }

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
          <form id="payment-form" className="space-y-4">
            <div id="stripe-payment-element" className="min-h-[300px]" />
            <button type="submit" className="w-full bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90">
              Pay ${(amount / 100).toFixed(2)}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}