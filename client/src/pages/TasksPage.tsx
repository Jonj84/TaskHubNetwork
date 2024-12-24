import { useState } from 'react';
import { useTasks } from '../hooks/use-tasks';
import { useUser } from '../hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TaskCard from '../components/TaskCard';
import { useToast } from '@/hooks/use-toast';
import type { Task, TaskType } from '../types';

export default function TasksPage() {
  const { tasks, createTask } = useTasks();
  const { user } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [newTask, setNewTask] = useState<Partial<Task>>({
    title: '',
    description: '',
    type: 'manual',
    reward: 0,
    proofRequired: '',
  });

  const handleCreateTask = async () => {
    try {
      await createTask(newTask);
      setOpen(false);
      toast({
        title: 'Success',
        description: 'Task created successfully',
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
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Available Tasks</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Create New Task</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Task Title"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              />
              <Textarea
                placeholder="Task Description"
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              />
              <Select
                value={newTask.type}
                onValueChange={(value: TaskType) => setNewTask({ ...newTask, type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Task Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="computational">Computational</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Reward (tokens)"
                value={newTask.reward}
                onChange={(e) => setNewTask({ ...newTask, reward: Number(e.target.value) })}
              />
              <Input
                placeholder="Required Proof"
                value={newTask.proofRequired}
                onChange={(e) => setNewTask({ ...newTask, proofRequired: e.target.value })}
              />
              <Button onClick={handleCreateTask}>Create Task</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tasks
          .filter((task) => task.status === 'open' && task.creatorId !== user?.id)
          .map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
      </div>
    </div>
  );
}
