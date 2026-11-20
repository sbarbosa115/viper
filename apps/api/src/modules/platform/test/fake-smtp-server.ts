import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';

export interface ReceivedMail {
  readonly from: string;
  readonly to: string[];
  readonly data: string;
  readonly auth: { user: string; pass: string } | null;
}

/** A tiny plain-text SMTP server for adapter tests: no TLS, accepts AUTH PLAIN/LOGIN. */
export class FakeSmtpServer {
  readonly received: ReceivedMail[] = [];
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  async start(): Promise<number> {
    this.server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.setEncoding('utf8');
    const reply = (line: string) => socket.write(`${line}\r\n`);
    const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

    let buffer = '';
    let mode: 'command' | 'data' | 'auth-plain' | 'auth-user' | 'auth-pass' = 'command';
    let from = '';
    let to: string[] = [];
    let data: string[] = [];
    let auth: ReceivedMail['auth'] = null;
    let user = '';

    const command = (line: string) => {
      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        reply('250-fake.smtp');
        reply('250-AUTH PLAIN LOGIN');
        reply('250 8BITMIME');
      } else if (upper.startsWith('AUTH PLAIN')) {
        const inline = line.split(' ')[2];
        if (inline) {
          const [, u = '', p = ''] = decode(inline).split('\u0000');
          auth = { user: u, pass: p };
          reply('235 2.7.0 Authenticated');
        } else {
          mode = 'auth-plain';
          reply('334 ');
        }
      } else if (upper.startsWith('AUTH LOGIN')) {
        mode = 'auth-user';
        reply('334 VXNlcm5hbWU6');
      } else if (upper.startsWith('MAIL FROM:')) {
        from = line.slice(10).replace(/[<>]/g, '').split(' ')[0] ?? '';
        reply('250 OK');
      } else if (upper.startsWith('RCPT TO:')) {
        to.push(line.slice(8).replace(/[<>]/g, '').trim());
        reply('250 OK');
      } else if (upper === 'DATA') {
        mode = 'data';
        reply('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper === 'STARTTLS') {
        reply('454 4.7.0 TLS not available');
      } else if (upper === 'QUIT') {
        reply('221 Bye');
        socket.end();
      } else {
        reply('250 OK');
      }
    };

    const onLine = (line: string) => {
      switch (mode) {
        case 'data':
          if (line === '.') {
            this.received.push({ from, to, data: data.join('\n'), auth });
            from = '';
            to = [];
            data = [];
            mode = 'command';
            reply('250 OK queued');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          return;
        case 'auth-plain': {
          const [, u = '', p = ''] = decode(line).split('\u0000');
          auth = { user: u, pass: p };
          mode = 'command';
          reply('235 2.7.0 Authenticated');
          return;
        }
        case 'auth-user':
          user = decode(line);
          mode = 'auth-pass';
          reply('334 UGFzc3dvcmQ6');
          return;
        case 'auth-pass':
          auth = { user, pass: decode(line) };
          mode = 'command';
          reply('235 2.7.0 Authenticated');
          return;
        default:
          command(line);
      }
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        onLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');
      }
    });
    reply('220 fake.smtp ESMTP');
  }
}
