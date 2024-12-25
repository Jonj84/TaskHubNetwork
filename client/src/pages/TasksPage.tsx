import { useState } from 'react';
import { useTasks } from '../hooks/use-tasks';
import { useUser } from '../hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import TaskCard from '../components/TaskCard';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Task } from '../types';

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title is too long'),
  description: z.string().min(1, 'Description is required').max(500, 'Description is too long'),
  type: z.enum(['manual', 'computational'] as const),
  reward: z.number().min(1, 'Reward must be at least 1 token').max(1000, 'Reward cannot exceed 1000 tokens'),
  proofType: z.enum(['confirmation_approval', 'image_upload', 'code_submission', 'text_submission'] as const),
  proofRequired: z.string().min(1, 'Proof requirement is required').max(200, 'Proof requirement is too long'),
});

type TaskFormData = z.infer<typeof taskSchema>;

export default function TasksPage() {
  const { tasks, createTask } = useTasks();
  const { user } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      type: 'manual',
      reward: 1,
      proofType: 'confirmation_approval',
      proofRequired: '',
    },
  });

  const handleCreateTask = async (data: TaskFormData) => {
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'You must be logged in to create tasks',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      await createTask(data);
      setOpen(false);
      form.reset();
      toast({
        title: 'Success',
        description: 'Task created successfully',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create task',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter tasks into two categories
  const availableTasks = tasks.filter(
    (task) => task.status === 'open' && task.creatorId !== user?.id
  );
  const myCreatedTasks = tasks.filter(
    (task) => task.creatorId === user?.id
  );

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Task Platform</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Create New Task</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
              <DialogDescription>
                Fill in the details below to create a new task.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreateTask)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Task Title" 
                          {...field}
                          aria-label="Task title"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Task Description" 
                          {...field}
                          aria-label="Task description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Type</FormLabel>
                      <FormControl>
                        <Select
                          defaultValue={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger aria-label="Select task type">
                            <SelectValue placeholder="Select task type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Manual</SelectItem>
                            <SelectItem value="computational">Computational</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="proofType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proof Type</FormLabel>
                      <FormControl>
                        <Select
                          defaultValue={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger aria-label="Select proof type">
                            <SelectValue placeholder="Select proof type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="confirmation_approval">Confirmation Approval</SelectItem>
                            <SelectItem value="image_upload">Image Upload</SelectItem>
                            <SelectItem value="code_submission">Code Submission</SelectItem>
                            <SelectItem value="text_submission">Text Submission</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reward"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reward (tokens)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="Reward amount"
                          min={1}
                          max={1000}
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          aria-label="Task reward amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="proofRequired"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required Proof</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="What proof is required?" 
                          {...field}
                          aria-label="Required proof"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isSubmitting}
                  aria-label={isSubmitting ? 'Creating task...' : 'Create task'}
                >
                  {isSubmitting ? 'Creating...' : 'Create Task'}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Available Tasks Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Available Tasks</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {availableTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
          {availableTasks.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-4">
              No tasks available at the moment.
            </p>
          )}
        </div>
      </div>

      {/* My Created Tasks Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">My Created Tasks</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {myCreatedTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
          {myCreatedTasks.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-4">
              You haven't created any tasks yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}