import { useUser } from '../hooks/use-user';
import { useTasks } from '../hooks/use-tasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TokenBalanceCard } from '../components/TokenBalanceCard';
import TaskCard from '../components/TaskCard';
import { LayoutDashboard, CheckCircle } from 'lucide-react';

export default function DashboardPage() {
  const { user } = useUser();
  const { tasks } = useTasks();

  const myTasks = tasks.filter(task => 
    task.creatorId === user?.id || task.workerId === user?.id
  );

  const activeTasks = myTasks.filter(t => t.status !== 'completed');
  const completedTasks = myTasks.filter(t => t.status === 'completed');

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6" />
          Dashboard
        </h1>
      </div>

      {/* Token Balance Section with Recent Transactions */}
      <div className="grid gap-6 md:grid-cols-2">
        <TokenBalanceCard />

        {/* Statistics Cards */}
        <div className="grid gap-4 grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Active Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col">
                <span className="text-2xl font-bold">{activeTasks.length}</span>
                <span className="text-xs text-muted-foreground">In progress</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Completed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col">
                <span className="text-2xl font-bold">{completedTasks.length}</span>
                <span className="text-xs text-muted-foreground">Total completed</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Tasks Section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Recent Tasks</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {myTasks.slice(0, 4).map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
          {myTasks.length === 0 && (
            <Card className="col-span-2">
              <CardContent className="py-8">
                <p className="text-center text-muted-foreground">No tasks found</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}