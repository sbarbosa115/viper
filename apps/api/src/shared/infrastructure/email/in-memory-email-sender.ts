import type { EmailMessage, EmailSender } from '../../application/email-sender.js';

export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}
