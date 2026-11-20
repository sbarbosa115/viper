import { z } from 'zod';
import { defineContract, err, id, idParams, isoDateTime } from './common.js';
import { profile } from './profile.js';

export const messageRole = z.enum(['user', 'assistant']);

export const message = z.object({
  id,
  role: messageRole,
  text: z.string(),
  /** 0–4 suggested answers (assistant messages only). */
  quickReplies: z.array(z.string()).max(4),
  createdAt: isoDateTime,
});
export type Message = z.infer<typeof message>;

export const conversation = z.object({
  id,
  messages: z.array(message),
  profileComplete: z.boolean(),
});
export type Conversation = z.infer<typeof conversation>;

export const sendMessageBody = z.object({
  text: z.string().trim().min(1).max(2_000),
  /**
   * "Retry" after a failed reply (FR-14): the id of the stored user message that got no reply.
   * The server replies to that message instead of storing the text again.
   */
  retryOfMessageId: id.optional(),
});
export type SendMessageBody = z.infer<typeof sendMessageBody>;

/** FR-14. Created on first read. */
export const getWelcomeConversation = defineContract({
  method: 'GET',
  path: '/api/conversations/welcome',
  auth: 'session',
  status: 200,
  response: conversation,
});

/** FR-14. 60 user messages per day per Business. The user message is kept on 503. */
export const sendMessage = defineContract({
  method: 'POST',
  path: '/api/conversations/:id/messages',
  auth: 'session',
  status: 200,
  params: idParams,
  body: sendMessageBody,
  response: z.object({
    /** The user message and the reply. */
    messages: z.array(message),
    profile,
    profileComplete: z.boolean(),
    /** Set when the reply created a Plan (FR-16). */
    planId: id.nullable(),
  }),
  errors: [err(404, 'NOT_FOUND'), err(429, 'TOO_MANY_REQUESTS'), err(503, 'ASSISTANT_UNAVAILABLE')],
});

export const assistantContracts = { getWelcomeConversation, sendMessage } as const;
