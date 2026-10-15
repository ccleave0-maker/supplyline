'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { usePlatform, type Listening, type Recording } from '@supplyline/platform';
import type { AiScreen, AiStatus, VoiceFillInput, VoiceResult, VoiceSchema, VoiceValue } from '../models';
import { Button, cx, ErrorBanner, TextArea } from './components';
import { useAction } from './hooks';
import { useAuthed } from './session';
import { applyScreenFields, scanScreenFields } from './screen-fields';

// ---------------------------------------------------------------------------
// Is voice on for me (cached for a minute; never includes keys)
// ---------------------------------------------------------------------------
let statusCache: { at: number; value: Promise<AiStatus> } | null = null;
export function useAiStatus(): AiStatus | null {
  const { api } = useAuthed();
  const [s, setS] = useState<AiStatus | null>(null);
  useEffect(() => {
    if (!statusCache || Date.now() - statusCache.at > 60_000) statusCache = { at: Date.now(), value: api.ai.status().catch(() => ({ available: false, screens: [], serverTranscribe: false, reason: null })) };
    let live = true;
    void statusCache.value.then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, [api]);
  return s;
}
export const forgetAiStatus = () => {
  statusCache = null;
};

// ---------------------------------------------------------------------------
// Talking: device speech recognition → server transcription → typing
// ---------------------------------------------------------------------------
type Phase = 'idle' | 'listening' | 'thinking' | 'typing' | 'done';

export function useTalk(serverTranscribe: boolean) {
  const platform = usePlatform();
  const { api } = useAuthed();
  const [phase, setPhase] = useState<Phase>('idle');
  const [partial, setPartial] = useState('');
  const listening = useRef<Listening | null>(null);
  const recording = useRef<Recording | null>(null);

  const start = async () => {
    setPartial('');
    if (await platform.speech.isAvailable()) {
      const l = await platform.speech.start({ language: 'en-CA' });
      if (l) {
        listening.current = l;
        l.onPartial(setPartial);
        setPhase('listening');
        return;
      }
    }
    if (serverTranscribe) {
      const r = await platform.speech.record();
      if (r) {
        recording.current = r;
        setPhase('listening');
        return;
      }
    }
    setPhase('typing'); // no speech on this device: type, or use the keyboard's / Windows' dictation
  };
  /** Stop listening; returns the words heard. */
  const stop = async (): Promise<string | null> => {
    setPhase('thinking');
    if (listening.current) {
      const text = await listening.current.stop();
      listening.current = null;
      return text;
    }
    if (recording.current) {
      const audio = await recording.current.stop();
      recording.current = null;
      if (!audio) return null;
      return (await api.ai.transcribe(audio)).text;
    }
    return null;
  };
  const cancel = () => {
    listening.current?.cancel();
    recording.current?.cancel();
    listening.current = null;
    recording.current = null;
    setPhase('idle');
  };
  return { phase, setPhase, partial, start, stop, cancel };
}

function MicIcon({ live }: { live?: boolean }) {
  return (
    <span aria-hidden="true" className={cx('inline-block text-xl leading-none', live && 'animate-pulse')}>
      🎤
    </span>
  );
}

/** The talk / type / see-what-changed panel shared by the field mic and the navigation mic. */
function VoicePanel({
  title,
  serverTranscribe,
  onText,
  onClose,
  result,
  onUndo,
}: {
  title: string;
  serverTranscribe: boolean;
  onText: (text: string) => Promise<void>;
  onClose: () => void;
  result: VoiceResult | null;
  onUndo?: () => void;
}) {
  const talk = useTalk(serverTranscribe);
  const [typed, setTyped] = useState('');
  const run = useAction(async (text: string | null) => {
    if (!text?.trim()) {
      talk.setPhase('typing');
      throw new Error('Didn’t catch that. Try again, or type it below.');
    }
    await onText(text.trim());
    talk.setPhase('done');
  });
  useEffect(() => {
    void talk.start();
    return () => talk.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div role="dialog" aria-label={title} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-4 shadow-2xl lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[30rem] lg:rounded-xl lg:border">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-ink">
          <MicIcon live={talk.phase === 'listening'} /> {title}
        </span>
        <Button variant="ghost" aria-label="Close" onClick={onClose}>
          ✕
        </Button>
      </div>
      {talk.phase === 'listening' && (
        <>
          <p className="min-h-12 text-lg text-ink">{talk.partial || <span className="text-muted">Listening… talk now.</span>}</p>
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={() => void talk.stop().then((t) => run.run(t))}>
              Done talking
            </Button>
            <Button variant="secondary" onClick={() => talk.setPhase('typing')}>
              Type instead
            </Button>
          </div>
        </>
      )}
      {(talk.phase === 'thinking' || run.busy) && <p className="text-muted">Working it out…</p>}
      {talk.phase === 'typing' && !run.busy && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run.run(typed);
          }}
        >
          <TextArea label="Say it in words" rows={3} value={typed} onChange={(e) => setTyped(e.target.value)} hint="Type it — or on a PC press Windows key + H to dictate, on a phone tap the keyboard’s mic." autoFocus />
          <div className="mt-2 flex gap-2">
            <Button type="submit" disabled={!typed.trim()}>
              Go
            </Button>
            <Button type="button" variant="secondary" onClick={() => void talk.start()}>
              <MicIcon /> Talk again
            </Button>
          </div>
        </form>
      )}
      <ErrorBanner error={run.error} />
      {talk.phase === 'done' && result && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted">
            Heard: <span className="text-ink">“{result.heard}”</span>
          </p>
          <p className="font-semibold text-ink">{result.summary}</p>
          {result.question && <p className="text-warn-ink">{result.question}</p>}
          <p className="text-sm text-muted">Nothing is saved until you save it.</p>
          <div className="mt-2 flex gap-2">
            {onUndo && (
              <Button variant="secondary" onClick={onUndo}>
                ↶ Undo
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setTyped('');
                void talk.start();
              }}
            >
              <MicIcon /> Say more
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The mic button on a screen: fills in what the screen allows
// ---------------------------------------------------------------------------
export interface VoiceTarget<S> {
  screen: AiScreen;
  schema: Omit<VoiceSchema, 'screen'>;
  /** What's on screen now */
  current: () => { values: Record<string, unknown>; rows: Record<string, unknown>[] };
  /** Apply the AI's changes */
  apply: (r: VoiceResult) => void;
  /** Copy of the screen's state for Undo, and putting it back */
  snapshot: () => S;
  restore: (s: S) => void;
  siteId?: string | null;
  companyId?: string | null;
}

export function VoiceButton<S>({ target, label = 'Talk' }: { target: VoiceTarget<S>; label?: string }) {
  const { api } = useAuthed();
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const before = useRef<S | null>(null);
  if (!status?.available || !status.screens.includes(target.screen)) return null;
  const onText = async (transcript: string) => {
    const input: VoiceFillInput = {
      transcript,
      schema: { ...target.schema, screen: target.screen } as VoiceFillInput['schema'],
      current: target.current() as VoiceFillInput['current'],
      siteId: target.siteId ?? null,
      companyId: target.companyId ?? null,
    };
    const r = await api.ai.fill(input);
    before.current = target.snapshot();
    target.apply(r);
    setResult(r);
  };
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} aria-label={`${label} — fill this in by voice`}>
        <MicIcon /> {label}
      </Button>
      {open && (
        <VoicePanel
          title="Fill in by voice"
          serverTranscribe={status.serverTranscribe}
          onText={onText}
          result={result}
          onUndo={
            result
              ? () => {
                  if (before.current != null) target.restore(before.current);
                  setResult({ ...result, summary: 'Undone — back to how it was.' });
                }
              : undefined
          }
          onClose={() => {
            setOpen(false);
            setResult(null);
          }}
        />
      )}
    </>
  );
}

/** Menu-bar mic: "open job 2249", "new BOL", "receive PO 1042"… */
export function VoiceNavButton({ destinations }: { destinations: { path: string; label: string }[] }) {
  const { api } = useAuthed();
  const router = useRouter();
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const undo = useRef<Record<string, string | boolean> | null>(null);
  if (!status?.available || !status.screens.includes('navigate')) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="sl-btn inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Voice: fill in this screen or go somewhere">
        <MicIcon />
      </button>
      {open && (
        <VoicePanel
          title="Say what to fill in, or where to go"
          serverTranscribe={status.serverTranscribe}
          result={result}
          onUndo={
            undo.current
              ? () => {
                  applyScreenFields(undo.current!);
                  undo.current = null;
                  setResult(null);
                }
              : undefined
          }
          onText={async (t) => {
            const fields = scanScreenFields();
            const r = await api.ai.navigate(t, destinations, fields.length ? { title: document.title || 'Bowron', path: window.location.pathname + window.location.search, fields } : null);
            setResult(r);
            if (Object.keys(r.set).length) undo.current = applyScreenFields(r.set);
            if (r.navigate) {
              router.push(r.navigate);
              setOpen(false);
              setResult(null);
            }
          }}
          onClose={() => {
            setOpen(false);
            setResult(null);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers for screens with lists of rows
// ---------------------------------------------------------------------------
/** Apply add / update / remove to a list. `make` turns AI values into a new row. */
export function applyRowOps<R>(rows: R[], ops: VoiceResult['rowOps'], update: (row: R, values: Record<string, VoiceValue>) => R, make?: (values: Record<string, VoiceValue>) => R): R[] {
  let next = [...rows];
  const removed = new Set<number>();
  for (const op of ops) {
    if (op.op === 'update' && op.index != null && next[op.index] && op.values) next[op.index] = update(next[op.index]!, op.values);
    if (op.op === 'remove' && op.index != null) removed.add(op.index);
  }
  next = next.filter((_, i) => !removed.has(i));
  if (make) for (const op of ops) if (op.op === 'add' && op.values) next.push(make(op.values));
  return next;
}
export const str = (v: VoiceValue | undefined) => (v == null ? '' : String(v));
