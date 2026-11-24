import type { Conversation } from '@app/contracts/assistant';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../../shared/api/client';
import { Button, ErrorState, Input, Skeleton } from '../../../shared/ui';
import { useProfile, useSendMessage, useWelcomeConversation } from '../api/hooks';
import { ProfilePanel, ProfileProgressLink } from '../components/profile-panel';
import { Thread } from '../components/thread';
import { copy } from '../copy';

/** How close to the end of the page still counts as "reading the newest message". */
const NEAR_BOTTOM_PX = 160;

function Chat({ conversation }: { conversation: Conversation }) {
  const navigate = useNavigate();
  const profile = useProfile();
  const sendMutation = useSendMessage(conversation.id);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [limited, setLimited] = useState(false);
  const lastText = useRef('');
  const nearBottom = useRef(true); // opens at the newest message
  const justSent = useRef(false);

  const send = (text: string, retryOfMessageId?: string) => {
    lastText.current = text;
    justSent.current = true;
    setFailed(false);
    setLimited(false);
    setDraft('');
    sendMutation.mutate(retryOfMessageId ? { text, retryOfMessageId } : { text }, {
      onSuccess: (res) => {
        if (res.planId) void navigate(`/plans/${res.planId}`);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 429) {
          setLimited(true);
          setDraft(text);
        } else {
          setFailed(true);
        }
      },
    });
  };

  const retry = () => {
    const last = conversation.messages.at(-1);
    if (last?.role === 'user' && last.text === lastText.current) send(last.text, last.id);
    else send(lastText.current);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text && !sendMutation.isPending) send(text);
  };

  const pending = sendMutation.isPending ? sendMutation.variables : undefined;
  const pendingText = pending && !pending.retryOfMessageId ? pending.text : null;

  // Track whether the reader is at the newest message; scrolling up to reread turns following off.
  useEffect(() => {
    const onScroll = () => {
      const fromBottom =
        document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      nearBottom.current = fromBottom <= NEAR_BOTTOM_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keep the newest message in view (the answer form is pinned below it), but only when the reader
  // is already near the bottom or has just sent a message, so rereading isn't interrupted.
  useEffect(() => {
    if (!nearBottom.current && !justSent.current) return;
    justSent.current = false;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [conversation.messages.length, pendingText, sendMutation.isPending, failed, limited]);

  return (
    <div className="mx-auto grid h-full w-full max-w-6xl gap-6 px-4 py-6 md:px-7 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label={copy.title} className="flex min-h-[60vh] min-w-0 flex-col gap-4">
        <h1 className="sr-only">{copy.title}</h1>
        <div className="lg:hidden">
          <ProfileProgressLink profile={profile.data} />
        </div>
        <Thread
          messages={conversation.messages}
          pendingText={pendingText}
          typing={sendMutation.isPending}
          failed={failed}
          limited={limited}
          onQuickReply={(text) => send(text)}
          onRetry={retry}
        />
        {/* Pinned to the bottom of the screen (above the mobile tab bar) so it never scrolls away. */}
        <form
          onSubmit={onSubmit}
          className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex items-end gap-2 border-t border-line bg-bg py-3 md:bottom-0"
        >
          <div className="flex-1">
            <label htmlFor="chat-input" className="mb-1.5 block text-[13px] font-medium text-fg">
              {copy.inputLabel}
            </label>
            <Input
              id="chat-input"
              value={draft}
              maxLength={2000}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={!draft.trim() || sendMutation.isPending}
          >
            {copy.send}
          </Button>
        </form>
      </section>
      <div className="hidden lg:block">
        <ProfilePanel profile={profile.data} />
      </div>
    </div>
  );
}

/** FR-14: the welcome chat, at /app/chat and at /app until the profile is complete. */
export function ChatPage() {
  const conversation = useWelcomeConversation();
  if (conversation.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Skeleton className="h-64" role="status" aria-label="Loading chat" />
      </div>
    );
  }
  if (conversation.isError) {
    return <ErrorState description={copy.loadFailed} onRetry={() => void conversation.refetch()} />;
  }
  return <Chat conversation={conversation.data} />;
}
