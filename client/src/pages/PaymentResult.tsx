import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle } from 'lucide-react';
import { queryClient } from '@/lib/queryClient';

export default function PaymentResult() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const searchParams = new URLSearchParams(window.location.search);
  const isSuccess = window.location.pathname.includes('/payment/success');
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    const verifyPayment = async () => {
      if (isSuccess && sessionId) {
        try {
          const response = await fetch(`/api/tokens/verify-payment?session_id=${sessionId}`, {
            credentials: 'include'
          });

          if (!response.ok) {
            throw new Error('Failed to verify payment');
          }

          const data = await response.json();
          
          // Invalidate user data to refresh token balance
          queryClient.invalidateQueries({ queryKey: ['/api/user'] });

          toast({
            title: 'Payment Successful',
            description: `Successfully purchased ${data.tokenAmount} tokens!`,
          });
        } catch (error) {
          console.error('Payment verification failed:', error);
          toast({
            variant: 'destructive',
            title: 'Verification Failed',
            description: 'Could not verify your payment. Please contact support.',
          });
        }
      }
    };

    verifyPayment();
  }, [isSuccess, sessionId, toast]);

  return (
    <div className="container mx-auto py-12 px-4">
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          {isSuccess ? (
            <div className="space-y-4">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
              <h1 className="text-2xl font-bold">Payment Successful!</h1>
              <p className="text-muted-foreground">
                Your tokens will be credited to your account shortly.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <XCircle className="h-12 w-12 text-red-500 mx-auto" />
              <h1 className="text-2xl font-bold">Payment Cancelled</h1>
              <p className="text-muted-foreground">
                Your payment was cancelled and you have not been charged.
              </p>
            </div>
          )}

          <Button
            onClick={() => setLocation('/')}
            className="mt-6"
          >
            Return to Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
