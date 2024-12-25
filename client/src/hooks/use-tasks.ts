import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task } from '../types';
import { useToast } from '@/hooks/use-toast';

export function useTasks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/tasks', {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = await response.json();
        console.log('[Tasks] Fetched tasks:', {
          count: data.length,
          tasks: data.map((t: Task) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            creatorId: t.creatorId
          }))
        });
        return data;
      } catch (error) {
        console.error('[Tasks] Fetch error:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to fetch tasks'
        });
        return [];
      }
    },
    staleTime: 0, // Always fetch fresh data
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: Partial<Task>) => {
      console.log('[Tasks] Creating task:', task);
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(task),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Tasks] Creation failed:', error);
        throw new Error(error);
      }

      const data = await response.json();
      console.log('[Tasks] Task created:', data);
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Task created successfully'
      });
      // Force refetch tasks after creation
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      // Also invalidate blockchain queries as task creation affects token balance
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain'] });
    },
  });

  return {
    tasks,
    isLoading,
    createTask: createTaskMutation.mutateAsync,
  };
}