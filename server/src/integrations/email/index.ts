import nodemailer, { type Transporter } from 'nodemailer';
import { db } from '../../lib/db';
import { env } from '../../lib/env';

export interface EmailAttachment {
  fileName: string;
  contentType: string;
  /** base64-encoded bytes */
  content: string;
}

export interface OutgoingEmail {
  /** Display name, e.g. "Jane Smith via SupplyLine" */
  fromName: string;
  replyTo?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  name: string;
  /** Sender address this provider must use (e.g. Gmail only sends as the signed-in account). */
  fromAddress?: () => string;
  send(msg: OutgoingEmail & { fromAddress: string }): Promise<{ messageId: string | null }>;
}

let smtpTransport: Transporter | null = null;

/** Any SMTP mailbox. With Gmail: smtp.gmail.com, port 465, your Gmail + an App Password. */
const smtpProvider: EmailProvider = {
  name: 'smtp',
  fromAddress: () => env().SMTP_FROM_ADDRESS || env().SMTP_USER,
  async send(msg) {
    const e = env();
    smtpTransport ??= nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
      // Fail fast where outgoing mail ports are blocked (e.g. some hosts' cheaper plans)
      // instead of keeping someone waiting on the sign-in screen.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const info = await smtpTransport.sendMail({
      from: { name: msg.fromName, address: msg.fromAddress },
      replyTo: msg.replyTo ?? undefined,
      to: msg.to,
      cc: msg.cc?.length ? msg.cc : undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments?.map((a) => ({ filename: a.fileName, content: Buffer.from(a.content, 'base64'), contentType: a.contentType })),
    });
    return { messageId: info.messageId ?? null };
  },
};

const consoleProvider: EmailProvider = {
  name: 'console',
  async send(msg) {
    console.log(
      `\n──── EMAIL (development — not actually sent) ────\nFrom: ${msg.fromName} <${msg.fromAddress}>` +
        (msg.replyTo ? `\nReply-To: ${msg.replyTo}` : '') +
        `\nTo: ${msg.to.join(', ')}` +
        (msg.cc?.length ? `\nCc: ${msg.cc.join(', ')}` : '') +
        `\nSubject: ${msg.subject}\n\n${msg.text}\n` +
        (msg.attachments?.length ? `\n[${msg.attachments.length} attachment(s)]\n` : '') +
        '────────────────────────────────────────────────\n',
    );
    return { messageId: null };
  },
};

const resendProvider: EmailProvider = {
  name: 'resend',
  async send(msg) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${msg.fromName} <${msg.fromAddress}>`,
        to: msg.to,
        cc: msg.cc?.length ? msg.cc : undefined,
        reply_to: msg.replyTo ?? undefined,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({ filename: a.fileName, content: a.content, content_type: a.contentType })),
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { id?: string };
    return { messageId: body.id ?? null };
  },
};

const sendgridProvider: EmailProvider = {
  name: 'sendgrid',
  async send(msg) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env().SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [
          { to: msg.to.map((email) => ({ email })), cc: msg.cc?.length ? msg.cc.map((email) => ({ email })) : undefined },
        ],
        from: { email: msg.fromAddress, name: msg.fromName },
        reply_to: msg.replyTo ? { email: msg.replyTo } : undefined,
        subject: msg.subject,
        content: [{ type: 'text/plain', value: msg.text }, ...(msg.html ? [{ type: 'text/html', value: msg.html }] : [])],
        attachments: msg.attachments?.map((a) => ({ filename: a.fileName, content: a.content, type: a.contentType })),
      }),
    });
    if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
    return { messageId: res.headers.get('x-message-id') };
  },
};

/** Primary provider first, then the fallback (if it has a key). */
function providerChain(): EmailProvider[] {
  const e = env();
  if (e.EMAIL_PROVIDER === 'console') return [consoleProvider];
  const chain: EmailProvider[] = [];
  const smtpReady = !!(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASSWORD);
  if (e.EMAIL_PROVIDER === 'smtp' && smtpReady) chain.push(smtpProvider);
  if (e.EMAIL_PROVIDER === 'resend' && e.RESEND_API_KEY) chain.push(resendProvider);
  if (e.EMAIL_PROVIDER === 'sendgrid' && e.SENDGRID_API_KEY) chain.push(sendgridProvider);
  // Fallbacks, in order, for whichever other services have keys.
  if (smtpReady && !chain.includes(smtpProvider)) chain.push(smtpProvider);
  if (e.RESEND_API_KEY && !chain.includes(resendProvider)) chain.push(resendProvider);
  if (e.SENDGRID_API_KEY && !chain.includes(sendgridProvider)) chain.push(sendgridProvider);
  if (chain.length === 0) throw new Error('No email service is configured (set up Gmail/SMTP, Resend or SendGrid in server/.env).');
  return chain;
}

/**
 * Sends an email and records it in EmailOutbox. Never throws: a failed send is
 * stored with status FAILED so it can be retried and shown to admins.
 */
export async function sendEmail(
  msg: OutgoingEmail,
  meta: {
    organizationId?: string | null;
    relatedType?: string;
    relatedId?: string;
    companyId?: string | null;
    templateKey?: string;
    /** Stored files attached (kept with the record so a reviewed email still has them) */
    attachmentFileIds?: string[];
    /** Hold it for someone to review instead of sending now */
    review?: boolean;
  } = {},
): Promise<{ ok: boolean; outboxId: string; held?: boolean }> {
  const record = await db.emailOutbox.create({
    data: {
      organizationId: meta.organizationId ?? null,
      fromName: msg.fromName,
      replyTo: msg.replyTo ?? null,
      to: msg.to,
      cc: msg.cc ?? [],
      subject: msg.subject,
      bodyText: msg.text,
      bodyHtml: msg.html ?? null,
      attachments: msg.attachments?.map((a) => ({ fileName: a.fileName, contentType: a.contentType })) ?? undefined,
      relatedType: meta.relatedType ?? null,
      relatedId: meta.relatedId ?? null,
      companyId: meta.companyId ?? null,
      templateKey: meta.templateKey ?? null,
      attachmentFileIds: meta.attachmentFileIds ?? [],
      status: meta.review ? 'REVIEW' : 'QUEUED',
    },
  });
  if (meta.review) return { ok: true, outboxId: record.id, held: true };
  return { ok: await deliverRecord(record.id, msg), outboxId: record.id };
}

/** Send an outbox record through the provider chain; records SENT or FAILED. */
export async function deliverRecord(recordId: string, msg: OutgoingEmail): Promise<boolean> {
  const record = { id: recordId };

  const errors: string[] = [];
  let chain: EmailProvider[];
  try {
    chain = providerChain();
  } catch (e) {
    chain = [];
    errors.push((e as Error).message);
  }
  for (const provider of chain) {
    try {
      const fromAddress = provider.fromAddress?.() ?? env().EMAIL_FROM_ADDRESS;
      const { messageId } = await provider.send({ ...msg, fromAddress });
      await db.emailOutbox.update({
        where: { id: record.id },
        data: { status: 'SENT', provider: provider.name, providerMessageId: messageId, sentAt: new Date(), attempts: { increment: 1 } },
      });
      return true;
    } catch (e) {
      errors.push(`${provider.name}: ${(e as Error).message}`);
    }
  }
  console.error('[email] send failed', errors);
  await db.emailOutbox.update({
    where: { id: record.id },
    data: { status: 'FAILED', error: errors.join('\n').slice(0, 4000), attempts: { increment: 1 } },
  });
  return false;
}

/** "Jane Smith via SupplyLine" */
export function viaName(personName: string | null | undefined): string {
  const product = env().EMAIL_FROM_NAME;
  return personName ? `${personName} via ${product}` : product;
}
