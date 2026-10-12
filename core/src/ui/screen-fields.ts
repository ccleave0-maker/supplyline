// Voice on any screen (including inside tabs): find the form fields that are
// visible right now, describe them to the AI, and fill them in exactly as if
// the person had typed — so each screen's own checks and saving still apply.

export interface ScreenField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: { value: string; label: string }[];
  value: string | boolean;
}

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const SKIP_TYPES = new Set(['hidden', 'file', 'password', 'search', 'range', 'button', 'submit', 'reset', 'image', 'color']);

function labelFor(el: FieldEl): string {
  const fromLabel = el.labels?.[0]?.textContent?.trim();
  const aria = el.getAttribute('aria-label')?.trim();
  const ph = 'placeholder' in el ? el.placeholder?.trim() : '';
  // Checkboxes in this app are wrapped by their label text.
  return (fromLabel || aria || ph || '').replace(/\s+/g, ' ').slice(0, 120);
}

function visible(el: HTMLElement) {
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** The fields on screen now (max 80), each tagged so it can be filled later. */
export function scanScreenFields(root: HTMLElement | null = typeof document !== 'undefined' ? (document.querySelector('[role="dialog"]') as HTMLElement | null) ?? document.getElementById('main') : null): ScreenField[] {
  if (!root) return [];
  const out: ScreenField[] = [];
  const els = Array.from(root.querySelectorAll<FieldEl>('input, select, textarea'));
  let i = 0;
  for (const el of els) {
    if (out.length >= 80) break;
    if (el.disabled || ('readOnly' in el && el.readOnly)) continue;
    if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) continue;
    if (!visible(el)) continue;
    const label = labelFor(el);
    if (!label) continue;
    const key = `f${i++}`;
    el.dataset.voiceKey = key;
    if (el instanceof HTMLSelectElement) {
      out.push({ key, label, type: 'select', value: el.value, options: Array.from(el.options).filter((o) => o.value !== '').slice(0, 150).map((o) => ({ value: o.value, label: o.text.trim() })) });
    } else if (el instanceof HTMLTextAreaElement) {
      out.push({ key, label, type: 'textarea', value: el.value });
    } else if (el.type === 'checkbox') {
      out.push({ key, label, type: 'checkbox', value: el.checked });
    } else {
      out.push({ key, label, type: el.type === 'number' || el.inputMode === 'decimal' || el.inputMode === 'numeric' ? 'number' : el.type === 'date' ? 'date' : 'text', value: el.value });
    }
  }
  return out;
}

function setNative(el: FieldEl, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

/** Fill fields by key. Returns what they were before (for Undo). */
export function applyScreenFields(set: Record<string, string | number | boolean | null>): Record<string, string | boolean> {
  const before: Record<string, string | boolean> = {};
  for (const [key, raw] of Object.entries(set)) {
    const el = document.querySelector<FieldEl>(`[data-voice-key="${key}"]`);
    if (!el || raw === undefined) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      before[key] = el.checked;
      if (!!raw !== el.checked) el.click();
      continue;
    }
    before[key] = el.value;
    setNative(el, raw == null ? '' : String(raw));
    // Screens that save when you leave a field.
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
  return before;
}
