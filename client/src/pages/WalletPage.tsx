import { useState } from 'react';
import { useTokens } from '../hooks/use-tokens';
import { useUser } from '../hooks/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function WalletPage() {
  const { user } = useUser();
  const { transactions, purchaseTokens, isLoading: isLoadingTransactions } = useTokens();
  const { toast } = useToast();
  const [amount, setAmount] = useState(0);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePurchase = async () => {
    if (amount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      setError(null);
      setIsPurchasing(true);
      await purchaseTokens(amount);
      setAmount(0);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsPurchasing(false);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Token Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{user?.tokenBalance}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Purchase Tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => {
                setError(null);
                setAmount(Number(e.target.value));
              }}
              disabled={isPurchasing}
              min="0"
            />
            <Button 
              onClick={handlePurchase} 
              className="w-full"
              disabled={isPurchasing || amount <= 0}
            >
              {isPurchasing ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Processing Transaction...
                </>
              ) : (
                'Purchase Tokens'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingTransactions ? (
            <div className="flex justify-center items-center py-8">
              <LoadingSpinner size="lg" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No transactions yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Task ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {format(new Date(tx.timestamp), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="capitalize">{tx.type}</TableCell>
                    <TableCell>{tx.amount}</TableCell>
                    <TableCell>{tx.taskId || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}