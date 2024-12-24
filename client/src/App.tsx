import { Switch, Route } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useUser } from './hooks/use-user';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import WalletPage from './pages/WalletPage';
import TokenMarketplace from './pages/TokenMarketplace';
import TokenHistory from './pages/TokenHistory';
import TransactionExplorer from './pages/TransactionExplorer';
import PaymentResult from './pages/PaymentResult';
import LoaderDemo from './pages/LoaderDemo';
import NavigationBar from './components/NavigationBar';
import ErrorDashboard from './components/ErrorDashboard';

function App() {
  const { user, isLoading, error } = useUser();

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="max-w-md p-6 rounded-lg bg-destructive/10 text-center">
          <p className="text-destructive">Failed to load user profile</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  // Payment result pages should be accessible without authentication
  if (window.location.pathname.startsWith('/payment/')) {
    return (
      <div className="min-h-screen bg-background">
        <Switch>
          <Route path="/payment/success" component={PaymentResult} />
          <Route path="/payment/cancel" component={PaymentResult} />
        </Switch>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      <NavigationBar />
      <div className="container mx-auto p-4">
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/tasks" component={TasksPage} />
          <Route path="/wallet" component={WalletPage} />
          <Route path="/marketplace" component={TokenMarketplace} />
          <Route path="/history" component={TokenHistory} />
          <Route path="/explorer" component={TransactionExplorer} />
          <Route path="/loader-demo" component={LoaderDemo} />
          <Route>
            <div className="flex items-center justify-center min-h-[60vh]">
              <p className="text-muted-foreground">404 - Page not found</p>
            </div>
          </Route>
        </Switch>

        {/* Error Dashboard positioned at the bottom of the viewport */}
        <div className="fixed bottom-4 right-4 w-96 max-w-[90vw]">
          <ErrorDashboard />
        </div>
      </div>
    </div>
  );
}

export default App;