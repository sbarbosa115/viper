import { describe, expect, test } from 'vitest';
import { defaultEventJobOptions } from '../../../shared/infrastructure/outbox/index.js';
import { SUPPORT_QUEUE, supportSubscriptions } from './support-worker.js';

describe('FR-11: support queue', () => {
  test('the four events go to the support queue, retried 5 times with exponential backoff', () => {
    expect(SUPPORT_QUEUE).toBe('support');
    expect(supportSubscriptions).toEqual(
      ['TicketOpened', 'CustomerReplied', 'StaffReplied', 'TicketClosed'].map((event) => ({
        event,
        queue: 'support',
      })),
    );
    expect(defaultEventJobOptions.attempts).toBe(5);
    expect(defaultEventJobOptions.backoff).toMatchObject({ type: 'exponential' });
  });
});
