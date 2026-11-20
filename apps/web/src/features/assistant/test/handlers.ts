import {
  conversation,
  message,
  sendMessage,
  sendMessageBody,
  type Conversation,
  type Message,
} from '@app/contracts/assistant';
import { errorResponse } from '@app/contracts/errors';
import {
  conversation as conversationExample,
  ids,
  message as messageExample,
  profile as profileExample,
} from '@app/contracts/examples';
import { http, HttpResponse } from 'msw';

type Next =
  | { status: 200; reply: Partial<Message>; planId?: string | null; complete?: boolean }
  | { status: 429 }
  | { status: 503 };

/** Tweak per test; `resetAssistantState()` restores the defaults. */
export const assistantState: {
  conversation: Conversation;
  /** What the next POST answers: a reply (with optional quick replies and plan), or an error status. */
  next: Next;
  /** The bodies the server received, in order. */
  received: unknown[];
  /** Counts user messages stored (503 keeps the message). */
  sequence: number;
  /** When set, POST waits for it (to observe the typing indicator). */
  gate: Promise<void> | null;
} = {
  conversation: conversationExample,
  next: { status: 200, reply: {} },
  received: [],
  sequence: 0,
  gate: null,
};

export function resetAssistantState() {
  assistantState.conversation = conversation.parse(conversationExample);
  assistantState.next = { status: 200, reply: {} };
  assistantState.received = [];
  assistantState.sequence = 0;
  assistantState.gate = null;
}
resetAssistantState();

const uuid = (n: number) => `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-11-19T10:05:00.000Z';

function fail(status: number, code: string, text: string) {
  return HttpResponse.json(errorResponse.parse({ error: { code, message: text } }), { status });
}

export const handlers = [
  http.get('*/api/conversations/welcome', () =>
    HttpResponse.json(conversation.parse(assistantState.conversation)),
  ),

  http.post('*/api/conversations/:id/messages', async ({ request }) => {
    const body = sendMessageBody.parse(await request.json());
    assistantState.received.push(body);
    await assistantState.gate;
    const next = assistantState.next;
    if (next.status === 429) return fail(429, 'TOO_MANY_REQUESTS', 'Daily limit reached');

    const convo = assistantState.conversation;
    const stored = body.retryOfMessageId
      ? convo.messages.find((m) => m.id === body.retryOfMessageId)
      : undefined;
    const user: Message =
      stored ??
      message.parse({
        ...messageExample,
        id: uuid(100 + assistantState.sequence++),
        role: 'user',
        text: body.text,
        quickReplies: [],
        createdAt: at,
      });
    if (!stored) assistantState.conversation = { ...convo, messages: [...convo.messages, user] };

    if (next.status === 503) return fail(503, 'ASSISTANT_UNAVAILABLE', 'Unavailable');

    const reply = message.parse({
      ...messageExample,
      id: uuid(200 + assistantState.sequence++),
      text: 'Thanks. Where are you located?',
      quickReplies: [],
      ...next.reply,
    });
    const complete = next.complete ?? false;
    assistantState.conversation = {
      ...assistantState.conversation,
      messages: [...assistantState.conversation.messages, reply],
      profileComplete: complete,
    };
    return HttpResponse.json(
      sendMessage.response.parse({
        messages: [user, reply],
        profile: { ...profileExample, complete },
        profileComplete: complete,
        planId: next.planId ?? null,
      }),
    );
  }),
];

export const conversationId = ids.conversation;
