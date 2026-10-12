'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AssistantMessageView } from '../models';
import { Button, cx, ErrorBanner } from './components';
import { useAction } from './hooks';
import { useAuthed } from './session';
import { useAiStatus, useTalk } from './voice';

/** One message, with Yes / No when the assistant offers to do something. */
function Bubble({ m, onAnswer, busy }: { m: AssistantMessageView; onAnswer: (yes: boolean) => void; busy: boolean }) {
  const mine = m.role === 'USER';
  return (
    <div className={cx('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div className={cx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2', mine ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-ink')}>{m.text}</div>
      {m.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {m.links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-brand-ink underline">
              {l.label}
            </Link>
          ))}
        </div>
      )}
      {m.action && (
        <div className="max-w-[85%] rounded-xl border border-line bg-surface p-2">
          <p className="text-sm text-ink">{m.action.confirm}</p>
          {m.actionStatus === 'PROPOSED' ? (
            <div className="mt-2 flex gap-2">
              <Button busy={busy} onClick={() => onAnswer(true)}>
                Yes, do it
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onAnswer(false)}>
                No
              </Button>
            </div>
          ) : (
            <p className={cx('mt-1 text-sm', m.actionStatus === 'FAILED' ? 'text-danger' : 'text-muted')}>
              {m.actionStatus === 'DONE' ? '✓ ' : m.actionStatus === 'CANCELLED' ? 'Not done. ' : ''}
              {m.actionResult?.message ?? ''}{' '}
              {m.actionResult?.href && (
                <Link href={m.actionResult.href} className="text-brand-ink underline">
                  Open it
                </Link>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The 💬 in the top bar: ask anything in plain words (or by voice). */
export function AssistantButton() {
  const { api } = useAuthed();
  const router = useRouter();
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageView[]>([]);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<{ id: string; title: string | null; updatedAt: string }[] | null>(null);
  const talk = useTalk(!!status?.serverTranscribe);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages]);

  const send = useAction(async (t: string) => {
    const said = t.trim();
    if (!said) return;
    setText('');
    const r = await api.assistant.ask({ conversationId: convoId, text: said, screen: { path: window.location.pathname + window.location.search, title: document.title || 'SupplyLine' } });
    setConvoId(r.conversationId);
    setMessages((m) => [...m, ...r.messages]);
    if (r.navigate) router.push(r.navigate);
  });
  const answer = useAction(async (id: string, yes: boolean) => {
    const m = await api.assistant.answer(id, yes);
    setMessages((all) => all.map((x) => (x.id === id ? m : x)));
  });
  const openPast = useAction(async (id: string) => {
    const c = await api.assistant.conversation(id);
    setConvoId(c.id);
    setMessages(c.messages);
    setHistory(null);
  });

  if (!status?.available || !status.screens.includes('assistant')) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="sl-btn inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-xl hover:bg-surface-2" aria-label="Ask the assistant">
        💬
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-label="Assistant" className="flex h-full w-full max-w-md flex-col bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between gap-2 border-b border-line p-3">
              <p className="font-bold text-ink">Assistant</p>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => void api.assistant.conversations().then(setHistory)}>
                  Past chats
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConvoId(null);
                    setMessages([]);
                    setHistory(null);
                  }}
                >
                  New
                </Button>
                <Button variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
                  ✕
                </Button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-3">
              {history ? (
                <ul className="flex flex-col divide-y divide-line">
                  {history.length === 0 && <li className="py-2 text-muted">No past chats.</li>}
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                      <button type="button" className="text-left text-ink underline" onClick={() => void openPast.run(h.id)}>
                        {h.title ?? 'Chat'}
                      </button>
                      <span className="shrink-0 text-sm text-muted">{new Date(h.updatedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
                    </li>
                  ))}
                </ul>
              ) : messages.length === 0 ? (
                <div className="text-muted">
                  <p>Ask in plain words, for example:</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    <li>Where’s the rebar for the bridge job?</li>
                    <li>What loads are going out tomorrow?</li>
                    <li>Add 10 bags of grout to 2249’s order list</li>
                    <li>Is PO 4512 late?</li>
                  </ul>
                  <p className="mt-2 text-sm">It only changes something after you say yes.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((m) => (
                    <Bubble key={m.id} m={m} busy={answer.busy} onAnswer={(yes) => void answer.run(m.id, yes)} />
                  ))}
                  {send.busy && <p className="text-sm text-muted">Thinking…</p>}
                  <div ref={end} />
                </div>
              )}
            </div>
            <ErrorBanner error={send.error || answer.error || openPast.error} />
            <form
              className="flex items-end gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send.run(text);
              }}
            >
              <textarea
                aria-label="Message"
                rows={2}
                value={talk.phase === 'listening' ? talk.partial || 'Listening…' : text}
                readOnly={talk.phase === 'listening'}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send.run(text);
                  }
                }}
                className="min-h-12 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-ink"
                placeholder="Ask anything…"
              />
              <Button
                variant="secondary"
                aria-label={talk.phase === 'listening' ? 'Stop and send' : 'Talk'}
                onClick={async () => {
                  if (talk.phase === 'listening') {
                    const heard = await talk.stop();
                    talk.setPhase('idle');
                    if (heard) await send.run(heard);
                  } else await talk.start();
                }}
              >
                {talk.phase === 'listening' ? '■' : '🎤'}
              </Button>
              <Button type="submit" busy={send.busy}>
                Send
              </Button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
