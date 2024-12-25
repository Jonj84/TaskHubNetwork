import { useState } from 'react';
import { useUser } from '../hooks/use-user';
import { useBlockchain } from '../hooks/use-blockchain';
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
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { format } from 'date-fns';

export default function WalletPage() {
  const { user } = useUser();
  const { transactions, createTransaction, isLoading } = useBlockchain();
  const [amount, setAmount] = useState(0);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleTransaction = async () => {
    if (!user) {
      setError("Please login first");
      return;
    }

    if (amount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!recipient) {
      setError("Please enter a recipient address");
      return;
    }

    try {
      setError(null);
      setIsProcessing(true);
      await createTransaction({ to: recipient, amount });
      setAmount(0);
      setRecipient('');
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsProcessing(false);
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
            <p className="text-3xl font-bold">{user?.tokenBalance || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Send Tokens</CardTitle>
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
              placeholder="Recipient Address"
              value={recipient}
              onChange={(e) => {
                setError(null);
                setRecipient(e.target.value);
              }}
              disabled={isProcessing}
            />
            <Input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => {
                setError(null);
                setAmount(Number(e.target.value));
              }}
              disabled={isProcessing}
              min="0"
            />
            <Button 
              onClick={handleTransaction} 
              className="w-full"
              disabled={isProcessing || amount <= 0 || !recipient || !user}
            >
              {isProcessing ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Processing Transaction...
                </>
              ) : (
                'Send Tokens'
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
          {isLoading ? (
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
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      {format(new Date(tx.timestamp), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>{tx.from}</TableCell>
                    <TableCell>{tx.to}</TableCell>
                    <TableCell>{tx.amount}</TableCell>
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