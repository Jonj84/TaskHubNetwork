import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CreditCard, Bitcoin } from 'lucide-react';

interface PaymentFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  packageId?: number;
}

export default function PaymentFlow({
  open,
  onOpenChange,
  amount,
  packageId,
}: PaymentFlowProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'crypto' | null>(null);

  const handleCardPayment = async () => {
    try {
      setIsProcessing(true);

      // Create the Stripe session
      const response = await fetch('/api/payments/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount, packageId }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { sessionId } = await response.json();

      // Initialize Stripe
      const stripe = await loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }

      // Use redirectToCheckout with relative URLs
      await stripe.redirectToCheckout({
        sessionId,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Payment Error',
        description: error.message || 'Failed to process payment',
      });
      setIsProcessing(false);
    }
  };

  const handleCryptoPayment = async () => {
    try {
      setIsProcessing(true);
      const response = await fetch('/api/payments/crypto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount, packageId }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { paymentAddress, cryptoAmount } = await response.json();

      toast({
        title: 'Crypto Payment',
        description: `Please send ${cryptoAmount} to ${paymentAddress}`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Payment Error',
        description: error.message || 'Failed to generate crypto payment',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Choose Payment Method</DialogTitle>
          <DialogDescription>
            Select how you'd like to pay for your tokens
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <Button
            onClick={() => {
              setPaymentMethod('card');
              handleCardPayment();
            }}
            disabled={isProcessing}
            className="flex items-center justify-center gap-2"
          >
            {isProcessing && paymentMethod === 'card' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            Pay with Card
          </Button>

          <Button
            onClick={() => {
              setPaymentMethod('crypto');
              handleCryptoPayment();
            }}
            disabled={isProcessing}
            variant="outline"
            className="flex items-center justify-center gap-2"
          >
            {isProcessing && paymentMethod === 'crypto' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bitcoin className="h-4 w-4" />
            )}
            Pay with Crypto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}