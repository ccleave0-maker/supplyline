// The only place Bowron talks to Claude (and to the optional speech-to-text
// service). Tests swap these out, so they never call the real services.

import Anthropic from '@anthropic-ai/sdk';

export type ClaudeContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export interface ClaudeToolCall {
  apiKey: string;
  model: string;
  system: string;
  content: ClaudeContent[];
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}

export interface ClaudeReply {
  input: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** Models that refused a forced tool choice — asked with "auto" from then on. */
const autoOnly = new Set<string>();

/** Some models (e.g. ones that always think first) don't accept a forced tool choice. */
const forcedChoiceRejected = (e: unknown) => e instanceof Anthropic.BadRequestError && /tool_choice/i.test(e.message);

async function realToolCall(c: ClaudeToolCall): Promise<ClaudeReply> {
  const client = new Anthropic({ apiKey: c.apiKey, maxRetries: 2, timeout: 60_000 });
  const tools = [{ name: c.tool.name, description: c.tool.description, input_schema: c.tool.input_schema as Anthropic.Tool.InputSchema }];
  const ask = (forced: boolean) =>
    client.messages.create({
      model: c.model,
      max_tokens: forced ? (c.maxTokens ?? 2048) : Math.max(c.maxTokens ?? 2048, 4096),
      system: forced ? c.system : `${c.system}\n\nAlways answer by calling the ${c.tool.name} tool exactly once. Do not answer in plain text.`,
      messages: [{ role: 'user', content: c.content as Anthropic.MessageParam['content'] }],
      tools,
      tool_choice: forced ? { type: 'tool', name: c.tool.name } : { type: 'auto' },
    });
  let res;
  if (autoOnly.has(c.model)) res = await ask(false);
  else {
    try {
      res = await ask(true);
    } catch (e) {
      if (!forcedChoiceRejected(e)) throw e;
      autoOnly.add(c.model);
      res = await ask(false);
    }
  }
  const block = res.content.find((b) => b.type === 'tool_use' && b.name === c.tool.name);
  if (block && block.type === 'tool_use') return { input: block.input, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  // Answered in text instead: use it if it's the JSON we asked for.
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      return { input: JSON.parse(json), inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch {
      /* fall through */
    }
  }
  throw new Error('Claude did not return the expected answer. Try again, or pick another model under Admin › AI.');
}

/** Whisper (OpenAI) speech-to-text, for devices that can't do it themselves. */
async function realTranscribe(apiKey: string, audio: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', audio, fileName);
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('prompt', 'Construction materials: rebar, 20M, 15M, tie wire, form ply, pipe pile, H-pile, culvert, geotextile, BOL, PO, yard, job number.');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { text?: string };
  return body.text?.trim() ?? '';
}

let toolCall = realToolCall;
let transcribeImpl = realTranscribe;

export const claudeToolCall = (c: ClaudeToolCall) => toolCall(c);
export const transcribeAudio = (apiKey: string, audio: Blob, fileName: string) => transcribeImpl(apiKey, audio, fileName);

/** Tests only: answer Claude calls without the network. */
export function setClaudeForTests(fn: typeof realToolCall | null, transcribe?: typeof realTranscribe | null) {
  toolCall = fn ?? realToolCall;
  transcribeImpl = transcribe ?? realTranscribe;
}
