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
      if (!isSuccess || !sessionId) {
        return;
      }

      console.log('[Payment] Starting verification:', { sessionId });

      try {
        const response = await fetch(
          `/api/tokens/verify-payment?session_id=${sessionId}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          }
        );

        const data = await response.json();
        console.log('[Payment] Verification response:', data);

        // Always refresh token data regardless of response
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['/api/user'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/tokens/history'] })
        ]);

        // If this window is a popup, close it
        if (window.opener) {
          window.opener.postMessage({ 
            type: 'PAYMENT_COMPLETE', 
            success: data.success,
            data
          }, '*');
          window.close();
          return;
        }

        // Only show success message if explicitly successful
        if (data.success) {
          toast({
            title: 'Payment Successful',
            description: 'Your tokens have been credited to your account.',
          });
        }

        // Redirect after a short delay
        setTimeout(() => {
          setLocation('/marketplace');
        }, 2000);

      } catch (error) {
        console.error('[Payment] Verification failed:', {
          error,
          sessionId
        });

        // Close popup even on error
        if (window.opener) {
          window.opener.postMessage({ 
            type: 'PAYMENT_COMPLETE', 
            success: false,
            error: error instanceof Error ? error.message : 'Verification failed'
          }, '*');
          window.close();
          return;
        }

        toast({
          variant: 'destructive',
          title: 'Verification Failed',
          description: 'Could not verify your payment. Please contact support.',
        });
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
              <h1 className="text-2xl font-bold">Processing Payment</h1>
              <p className="text-muted-foreground">
                Please wait while we verify your payment...
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