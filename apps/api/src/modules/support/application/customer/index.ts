import type { CustomerSupportDeps } from './deps.js';
import { GetTicket, ListSupportRuns, ListTickets } from './read.js';
import { CloseTicket, CreateTicket, ReplyToTicket } from './write.js';

export type { CustomerSupportDeps } from './deps.js';
export { GetTicket, ListSupportRuns, ListTickets } from './read.js';
export type { TicketListResult } from './read.js';
export { CloseTicket, CreateTicket, ReplyToTicket } from './write.js';
export type { CreateTicketResult } from './write.js';

export interface CustomerSupportUseCases {
  listTickets: ListTickets;
  createTicket: CreateTicket;
  getTicket: GetTicket;
  replyToTicket: ReplyToTicket;
  closeTicket: CloseTicket;
  listSupportRuns: ListSupportRuns;
}

export function createCustomerSupport(deps: CustomerSupportDeps): CustomerSupportUseCases {
  return {
    listTickets: new ListTickets(deps),
    createTicket: new CreateTicket(deps),
    getTicket: new GetTicket(deps),
    replyToTicket: new ReplyToTicket(deps),
    closeTicket: new CloseTicket(deps),
    listSupportRuns: new ListSupportRuns(deps),
  };
}
