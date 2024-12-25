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
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain'] });
    },
  });

  const acceptTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      console.log('[Tasks] Accepting task:', taskId);
      const response = await fetch(`/api/tasks/${taskId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Tasks] Accept failed:', error);
        throw new Error(error);
      }

      const data = await response.json();
      console.log('[Tasks] Task accepted:', data);
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Task accepted successfully'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    },
  });

  const submitProofMutation = useMutation({
    mutationFn: async ({ taskId, proof }: { taskId: number; proof: string }) => {
      console.log('[Tasks] Submitting proof:', { taskId, proof });
      const response = await fetch(`/api/tasks/${taskId}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proof }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Tasks] Proof submission failed:', error);
        throw new Error(error);
      }

      const data = await response.json();
      console.log('[Tasks] Proof submitted:', data);
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Proof submitted successfully'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    },
  });

  const verifyTaskMutation = useMutation({
    mutationFn: async ({ taskId, verified }: { taskId: number; verified: boolean }) => {
      console.log('[Tasks] Verifying task:', { taskId, verified });
      const response = await fetch(`/api/tasks/${taskId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ verified }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Tasks] Verification failed:', error);
        throw new Error(error);
      }

      const data = await response.json();
      console.log('[Tasks] Task verified:', data);
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Task verification successful'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain'] });
    },
  });

  return {
    tasks,
    isLoading,
    createTask: createTaskMutation.mutateAsync,
    acceptTask: acceptTaskMutation.mutateAsync,
    submitProof: submitProofMutation.mutateAsync,
    verifyTask: verifyTaskMutation.mutateAsync,
  };
}