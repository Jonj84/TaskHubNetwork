import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { Loader2, TrendingUp, History, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';

interface Transaction {
  id: number;
  amount: number;
  type: string;
  timestamp: string;
  packageId: number | null;
}

interface Insights {
  totalSpent: number;
  totalTransactions: number;
  avgPurchaseSize: number;
}

interface TokenHistoryResponse {
  transactions: Transaction[];
  insights: Insights;
}

export default function TokenHistory() {
  const { data, isLoading, isError } = useQuery<TokenHistoryResponse>({
    queryKey: ['/api/tokens/history'],
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading transaction history...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto py-8">
        <Card className="bg-destructive/10">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Failed to load transaction history</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const insights = data?.insights;
  const transactions = data?.transactions || [];

  return (
    <div className="container mx-auto py-8 space-y-8">
      <h1 className="text-4xl font-bold">Token History</h1>

      {insights && (
        <div className="grid gap-4 md:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Tokens Purchased
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{insights.totalSpent}</div>
                <p className="text-xs text-muted-foreground">
                  Lifetime token purchases
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Transactions
                </CardTitle>
                <History className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{insights.totalTransactions}</div>
                <p className="text-xs text-muted-foreground">
                  Number of purchases made
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Average Purchase Size
                </CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{insights.avgPurchaseSize}</div>
                <p className="text-xs text-muted-foreground">
                  Average tokens per transaction
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>
            A detailed view of your token purchase history
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Package</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {format(new Date(transaction.timestamp), 'MMM d, yyyy h:mm a')}
                  </TableCell>
                  <TableCell className="capitalize">{transaction.type}</TableCell>
                  <TableCell>{transaction.amount} tokens</TableCell>
                  <TableCell>
                    {transaction.packageId ? `Package #${transaction.packageId}` : 'Custom Amount'}
                  </TableCell>
                </TableRow>
              ))}
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No transactions found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}