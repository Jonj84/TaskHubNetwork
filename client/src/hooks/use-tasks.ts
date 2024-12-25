import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task } from '../types';

export function useTasks() {
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
    staleTime: 0, // Always fetch fresh data
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: Partial<Task>) => {
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

      return response.json();
    },
    onSuccess: () => {
      // Force refetch tasks after creation
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      // Also invalidate blockchain queries as task creation affects token balance
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain'] });
    },
  });

  const submitProofMutation = useMutation({
    mutationFn: async ({ taskId, proof }: { taskId: number; proof: string }) => {
      const response = await fetch(`/api/tasks/${taskId}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proof }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    },
  });

  const verifyTaskMutation = useMutation({
    mutationFn: async ({ taskId, verified }: { taskId: number; verified: boolean }) => {
      const response = await fetch(`/api/tasks/${taskId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ verified }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      // Also invalidate blockchain queries as verification affects token balance
      queryClient.invalidateQueries({ queryKey: ['/api/blockchain'] });
    },
  });

  return {
    tasks,
    isLoading,
    createTask: createTaskMutation.mutateAsync,
    submitProof: submitProofMutation.mutateAsync,
    verifyTask: verifyTaskMutation.mutateAsync,
  };
}