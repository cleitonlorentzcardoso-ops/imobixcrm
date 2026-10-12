"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export function useTransferConversationToQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, queueId, reason }: { conversationId: string; queueId: string; reason?: string }) =>
      apiClient.post(`/api/v1/conversations/${conversationId}/transfer-to-queue`, { queue_id: queueId, ...(reason ? { reason } : {}) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["conversations"] }); toast.success("Conversa enviada para a fila."); },
    onError: showApiError,
  });
}
