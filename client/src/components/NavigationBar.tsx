import { Link } from 'wouter';
import { useUser } from '../hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu';
import { useToast } from '@/hooks/use-toast';
import { Coins } from 'lucide-react';

export default function NavigationBar() {
  const { user, logout } = useUser();
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
          <div className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4" />
            <span>{user?.tokenBalance || 0} tokens</span>
          </div>
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