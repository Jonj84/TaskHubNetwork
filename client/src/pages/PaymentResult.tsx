import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle } from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { logErrorToServer } from '@/lib/errorLogging';

export default function PaymentResult() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const searchParams = new URLSearchParams(window.location.search);
  const isSuccess = window.location.pathname.includes('/payment/success');
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    const verifyPayment = async () => {
      if (isSuccess && sessionId) {
        console.log('Starting payment verification:', { sessionId });
        try {
          const response = await fetch(`/api/tokens/verify-payment?session_id=${sessionId}`, {
            credentials: 'include',
            headers: {
              'Accept': 'application/json'
            }
          });

          console.log('Verification response received:', {
            status: response.status,
            ok: response.ok
          });

          const contentType = response.headers.get('content-type');
          if (!contentType?.includes('application/json')) {
            console.error('Invalid response type:', contentType);
            throw new Error('Invalid server response');
          }

          const data = await response.json();
          console.log('Payment verified successfully:', data);

          // Refresh token balance and history
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['/api/user'] }),
            queryClient.invalidateQueries({ queryKey: ['/api/tokens/history'] })
          ]);

          // If this window is a popup, notify parent and close
          if (window.opener) {
            try {
              window.opener.postMessage({ 
                type: 'PAYMENT_COMPLETE', 
                success: true,
                data
              }, '*');
              window.close();
            } catch (error) {
              console.error('Failed to communicate with parent window:', error);
            }
          } else {
            // If not a popup, show toast and redirect
            toast({
              title: 'Payment Successful',
              description: `Successfully purchased ${data.tokenAmount} tokens! Your new balance is ${data.newBalance} tokens.`,
            });

            setTimeout(() => {
              setLocation('/marketplace');
            }, 2000);
          }

        } catch (error: any) {
          await logErrorToServer(error, 'payment_verification_failed');
          console.error('Payment verification failed:', {
            error,
            sessionId,
            message: error.message
          });
          toast({
            variant: 'destructive',
            title: 'Verification Failed',
            description: 'Could not verify your payment. Please contact support.',
          });
        }
      }
    };

    verifyPayment();
  }, [isSuccess, sessionId, toast, setLocation]);

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
            onClick={() => setLocation('/marketplace')}
            className="mt-6"
          >
            Return to Marketplace
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}