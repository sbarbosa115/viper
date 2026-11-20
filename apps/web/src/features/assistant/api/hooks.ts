import { getWelcomeConversation, sendMessage } from '@app/contracts/assistant';
import type { Conversation, Message, SendMessageBody } from '@app/contracts/assistant';
import { getProfile } from '@app/contracts/profile';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../../shared/api/client';

export const conversationKey = ['conversation', 'welcome'] as const;
/** Shared with the profile and plans features: one cache entry for the Business Profile. */
export const profileKey = ['profile'] as const;
export const plansKey = ['plans'] as const;

export function useWelcomeConversation() {
  return useQuery({
    queryKey: conversationKey,
    queryFn: () => api('/conversations/welcome', { schema: getWelcomeConversation.response }),
    retry: false,
  });
}

export function useProfile() {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => api('/profile', { schema: getProfile.response }),
    retry: false,
  });
}

/** Appends messages the thread does not have yet (a retry returns the stored user message again). */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const known = new Set(current.map((m) => m.id));
  return [...current, ...incoming.filter((m) => !known.has(m.id))];
}

/**
 * FR-14: sends one message. On any failure except the daily limit the server keeps the user message,
 * so the thread is refetched to learn its id; "Retry" then sends `retryOfMessageId`.
 */
export function useSendMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SendMessageBody) =>
      api(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body,
        schema: sendMessage.response,
      }),
    onSuccess: (res) => {
      client.setQueryData<Conversation>(conversationKey, (current) =>
        current
          ? {
              ...current,
              messages: mergeMessages(current.messages, res.messages),
              profileComplete: res.profileComplete,
            }
          : current,
      );
      client.setQueryData(profileKey, res.profile);
      if (res.planId) void client.invalidateQueries({ queryKey: plansKey });
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 429) return;
      await client.refetchQueries({ queryKey: conversationKey });
    },
  });
}
