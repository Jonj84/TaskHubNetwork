import { useUser } from '../hooks/use-user';
import { useTasks } from '../hooks/use-tasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import TaskCard from '../components/TaskCard';

export default function DashboardPage() {
  const { user } = useUser();
  const { tasks } = useTasks();

  const myTasks = tasks.filter(task => 
    task.creatorId === user?.id || task.workerId === user?.id
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Token Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{user?.tokenBalance}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>My Active Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {myTasks.filter(t => t.status !== 'completed').length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Completed Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {myTasks.filter(t => t.status === 'completed').length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Recent Tasks</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {myTasks.slice(0, 4).map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      </div>
    </div>
  );
}
