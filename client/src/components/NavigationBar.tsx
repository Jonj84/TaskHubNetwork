import { Link } from 'wouter';
import { useUser } from '../hooks/use-user';
import { useBlockchain } from '../hooks/use-blockchain';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from '@/hooks/use-toast';
import { Coins, ArrowDownUp } from 'lucide-react';
import { format } from 'date-fns';

export default function NavigationBar() {
  const { user, logout } = useUser();
  const { balance, isLoading, transactions = [] } = useBlockchain();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout();
      toast({
        title: 'Success',
        description: 'Logged out successfully',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    }
  };

  const recentTransactions = transactions.slice(0, 4);

  return (
    <div className="border-b">
      <div className="container mx-auto px-4 py-2 flex justify-between items-center">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/" className="font-bold">
                  Task Platform
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/tasks">Tasks</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/wallet">Wallet</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/explorer">Explorer</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center gap-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="ghost" 
                className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 rounded-full hover:bg-primary/10"
              >
                <Coins className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {isLoading ? (
                    <span className="text-muted-foreground">Loading...</span>
                  ) : (
                    `${balance.toLocaleString()} tokens`
                  )}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-4 border-b">
                <h4 className="font-semibold">Recent Transactions</h4>
              </div>
              <div className="divide-y">
                {recentTransactions.map((tx) => (
                  <div key={tx.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                        ${tx.type === 'purchase' ? 'bg-green-100 text-green-800' :
                        tx.type === 'escrow' ? 'bg-yellow-100 text-yellow-800' :
                        tx.type === 'release' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'}`}
                      >
                        {tx.type}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(tx.timestamp), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {tx.amount} tokens
                      </span>
                    </div>
                  </div>
                ))}
                {recentTransactions.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground">
                    No recent transactions
                  </div>
                )}
              </div>
              <div className="p-4 border-t bg-muted/50">
                <Button variant="outline" asChild className="w-full">
                  <Link href="/explorer">View All Transactions</Link>
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button variant="default" asChild className="gap-2">
            <Link href="/marketplace">
              <Coins className="h-4 w-4" />
              Purchase Tokens
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">{user?.username}</span>
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}