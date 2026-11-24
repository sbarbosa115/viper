import { InMemorySupportStore } from './in-memory-support.js';
import { describeTicketRepositoryContract } from './ticket-repository-contract.js';

describeTicketRepositoryContract('InMemorySupportStore', () => {
  const store = new InMemorySupportStore();
  return Promise.resolve({ store, published: () => Promise.resolve([...store.published]) });
});
