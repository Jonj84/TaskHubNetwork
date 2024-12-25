import { useBlockchain } from '../hooks/use-blockchain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Coins } from 'lucide-react';
import { format } from 'date-fns';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TokenBrowser } from './TokenBrowser';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from './ui/button';
import { ChevronDown } from 'lucide-react';

export function TokenBalanceCard() {
  const { balance, isLoading, transactions = [], tokens = [] } = useBlockchain();

  // Get the most recent 4 transactions, including sends, purchases, and task-related
  const recentTransactions = transactions
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 4)
    .map(tx => ({
      ...tx,
      // Convert the amount to be relative to the current user's perspective
      amount: tx.type === 'send' ? -tx.amount : 
              tx.type === 'receive' ? tx.amount :
              tx.type === 'escrow' ? -tx.amount :
              tx.type === 'release' ? tx.amount :
              tx.type === 'purchase' ? tx.amount : -tx.amount
    }));

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'purchase': return 'Token Purchase';
      case 'escrow': return 'Task Escrow Lock';
      case 'release': return 'Task Completion Release';
      case 'send': return 'Sent Tokens';
      case 'receive': return 'Received Tokens';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          Token Balance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-col">
            <span className="text-3xl font-bold">
              {isLoading ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : (
                balance.toLocaleString()
              )}
            </span>
            <span className="text-sm text-muted-foreground">Available tokens</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <TooltipProvider>
              {recentTransactions.map((tx) => (
                <Tooltip key={tx.id}>
                  <TooltipTrigger>
                    <div
                      className="flex flex-col gap-1 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors cursor-help"
                    >
                      <div className={`text-sm font-medium ${
                        tx.amount > 0 ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {tx.amount > 0 ? '+' : ''}{tx.amount}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(tx.timestamp), 'MMM d, h:mm a')}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="p-3 space-y-1">
                    <p className="font-medium">{getTransactionLabel(tx.type)}</p>
                    <p className="text-sm text-muted-foreground">
                      Amount: {Math.abs(tx.amount)} tokens
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(tx.timestamp), 'MMM d, yyyy h:mm a')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tx.from} → {tx.to}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
            {recentTransactions.length === 0 && (
              <div className="w-full text-center text-sm text-muted-foreground py-2">
                No recent transactions
              </div>
            )}
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full">
                <ChevronDown className="h-4 w-4 mr-2" />
                View All Tokens
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4">
              <TokenBrowser tokens={tokens} isLoading={isLoading} />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>
    </Card>
  );
}