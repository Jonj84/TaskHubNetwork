import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CreditCard, Bitcoin } from 'lucide-react';

interface PaymentFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount?: number;
  packageId?: number;
}

export default function PaymentFlow({
  open,
  onOpenChange,
  amount: defaultAmount,
  packageId,
}: PaymentFlowProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'crypto' | null>(null);
  const [customAmount, setCustomAmount] = useState<string>(defaultAmount?.toString() || '');

  const handleCardPayment = async () => {
    try {
      const tokenAmount = parseInt(customAmount);
      if (isNaN(tokenAmount) || tokenAmount < 1 || tokenAmount > 10000) {
        toast({
          variant: 'destructive',
          title: 'Invalid Amount',
          description: 'Please enter a token amount between 1 and 10,000',
        });
        return;
      }

      setIsProcessing(true);

      // Create the Stripe session
      const response = await fetch('/api/payments/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          packageId 
            ? { packageId } 
            : { customAmount: tokenAmount }
        ),
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

      // Redirect to checkout
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
      const tokenAmount = parseInt(customAmount);
      if (isNaN(tokenAmount) || tokenAmount < 1 || tokenAmount > 10000) {
        toast({
          variant: 'destructive',
          title: 'Invalid Amount',
          description: 'Please enter a token amount between 1 and 10,000',
        });
        return;
      }

      setIsProcessing(true);
      const response = await fetch('/api/payments/crypto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: tokenAmount }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { paymentAddress, amount, currency } = await response.json();

      toast({
        title: 'Crypto Payment',
        description: `Please send ${amount} ${currency} to ${paymentAddress}`,
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
          <DialogTitle>Purchase Tokens</DialogTitle>
          <DialogDescription>
            Enter the amount of tokens you'd like to purchase
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="amount">Token Amount</Label>
            <Input
              id="amount"
              type="number"
              placeholder="Enter amount of tokens"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              min={1}
              max={10000}
              className="col-span-3"
            />
            <p className="text-sm text-muted-foreground">
              Enter a value between 1 and 10,000 tokens
            </p>
          </div>

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