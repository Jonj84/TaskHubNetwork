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

// Initialize Stripe - This part is no longer needed with the iframe approach
// let stripePromise: Promise<any> | null = null;
// const getStripe = () => {
//   if (!stripePromise && import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
//     stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
//   }
//   return stripePromise;
// };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkoutUrl?: string;
  amount?:number; //keeping amount for toast message
}

export default function StripeCheckoutDialog({ open, onOpenChange, checkoutUrl, amount }: Props) {
  const { toast } = useToast();

  useEffect(() => {
    //This effect is no longer needed.  The checkout handling is done entirely client-side now.
  }, [open, checkoutUrl, amount, onOpenChange, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogTitle>Complete Purchase</DialogTitle>
        {!checkoutUrl ? (
          <div className="flex items-center justify-center p-8">
            <BlockchainLoader size="lg" />
          </div>
        ) : (
          <div className="relative w-full min-h-[600px]">
            <iframe
              src={checkoutUrl}
              className="absolute inset-0 w-full h-full border-0"
              frameBorder="0"
              allow="payment"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}