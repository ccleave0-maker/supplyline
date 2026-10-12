'use client';

import { useEffect, useState } from 'react';
import type { ItemSuggestion } from '../models';
import { useDebounced } from './hooks';
import { useAuthed } from './session';

/** Items this organization has ordered before that match what's being typed (this job first). */
export function useItemSuggestions(q: string, f: { siteId?: string | null; companyId?: string | null } = {}): ItemSuggestion[] {
  const { api } = useAuthed();
  const term = useDebounced(q.trim(), 250);
  const [items, setItems] = useState<ItemSuggestion[]>([]);
  useEffect(() => {
    if (term.length < 2) return setItems([]);
    let live = true;
    api.suggestions
      .items({ q: term, siteId: f.siteId ?? undefined, companyId: f.companyId ?? undefined })
      .then((r) => live && setItems(r))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [api, term, f.siteId, f.companyId]);
  return items;
}

export function ItemList({ id, items }: { id: string; items: ItemSuggestion[] }) {
  return (
    <datalist id={id}>
      {items.map((s) => (
        <option key={s.description} value={s.description}>
          {[s.uom, s.costCode, `ordered ${s.count}×`].filter(Boolean).join(' · ')}
        </option>
      ))}
    </datalist>
  );
}

/** Tell SupplyLine a suggestion was kept (or changed) so it gets better. Never blocks. */
export function useSuggestionFeedback() {
  const { api } = useAuthed();
  return (f: Parameters<typeof api.suggestions.feedback>[0]) => void api.suggestions.feedback(f).catch(() => undefined);
}
