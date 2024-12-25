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
import { AlertTriangle, Award, ArrowRightLeft, Database } from "lucide-react";
import { format } from 'date-fns';
import { Transaction } from '../lib/blockchain/types';
import { motion } from 'framer-motion';

interface GroupedTransactions {
  miningRewards: Transaction[];
  transfers: Transaction[];
}

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

  // Filter transactions for current user
  const userTransactions = transactions.filter(tx => 
    tx.from === user?.username || tx.to === user?.username
  );

  // Group transactions by type for better organization
  const groupedTransactions = userTransactions.reduce<GroupedTransactions>((acc, tx) => {
    if (tx.type === 'mint') {
      acc.miningRewards.push(tx);
    } else {
      acc.transfers.push(tx);
    }
    return acc;
  }, { miningRewards: [], transfers: [] });

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Token Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{user?.tokenBalance || 0}</p>
            <p className="text-sm text-muted-foreground">Available tokens</p>
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

      {/* Mining Rewards Section */}
      {groupedTransactions.miningRewards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5" />
              Mining Rewards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Block Hash</TableHead>
                  <TableHead>Token IDs</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedTransactions.miningRewards.map((tx, index) => (
                  <motion.tr
                    key={tx.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="border-b border-border hover:bg-muted/50"
                  >
                    <TableCell>
                      {format(new Date(tx.timestamp), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.blockHash?.substring(0, 10)}...
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.tokenIds?.map(id => id.substring(0, 6)).join(', ')}
                    </TableCell>
                    <TableCell className="text-green-600">
                      +1 (Mining Reward)
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Token Transfers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <LoadingSpinner size="lg" />
            </div>
          ) : groupedTransactions.transfers.length === 0 ? (
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
                  <TableHead>Token IDs</TableHead>
                  <TableHead>Block Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedTransactions.transfers.map((tx, index) => (
                  <motion.tr
                    key={tx.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="border-b border-border hover:bg-muted/50"
                  >
                    <TableCell>
                      {format(new Date(tx.timestamp), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>{tx.from === user?.username ? 'You' : tx.from}</TableCell>
                    <TableCell>{tx.to === user?.username ? 'You' : tx.to}</TableCell>
                    <TableCell className={tx.to === user?.username ? 'text-green-600' : 'text-red-600'}>
                      {tx.to === user?.username ? '+' : '-'}{tx.tokenIds?.length || tx.amount}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.tokenIds?.map(id => id.substring(0, 6)).join(', ')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.blockHash?.substring(0, 10)}...
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}