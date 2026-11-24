export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Overrides the sender's display name (e.g. "Llyner Leads Support"); the address stays the configured one. */
  readonly fromName?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
