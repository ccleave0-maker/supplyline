'use client';

import { useState } from 'react';
import type { NavLayout } from '../models';
import { Button, Checkbox, cx, SelectField, TextField } from './components';
import { areaIcon, defaultAreas } from './nav-arrange';

export interface CatalogItem {
  href: string;
  label: string;
  icon: string;
}

/**
 * Drag menu items between areas and into order. Every item also has ↑ / ↓ and a
 * "move to" picker (for phones and keyboards). mode "admin": areas can be added,
 * renamed and removed. mode "personal": items can be hidden from your own menu.
 */
export function NavEditor({ catalog, value, onChange, mode }: { catalog: CatalogItem[]; value: NavLayout; onChange: (v: NavLayout) => void; mode: 'admin' | 'personal' }) {
  const [drag, setDrag] = useState<string | null>(null);
  const label = (href: string) => catalog.find((c) => c.href === href);
  const placed = new Set(value.groups.flatMap((g) => g.items));
  const loose = catalog.filter((c, i) => i > 0 && !placed.has(c.href)).map((c) => c.href); // Home stays first
  const LOOSE = '__loose';

  const moveTo = (href: string, groupId: string, before?: string) => {
    const groups = value.groups.map((g) => ({ ...g, items: g.items.filter((x) => x !== href) }));
    if (groupId !== LOOSE) {
      const g = groups.find((x) => x.id === groupId);
      if (g) {
        const at = before ? g.items.indexOf(before) : -1;
        if (at >= 0) g.items.splice(at, 0, href);
        else g.items.push(href);
      }
    }
    onChange({ ...value, groups });
  };
  const nudge = (groupId: string, href: string, d: -1 | 1) => {
    onChange({
      ...value,
      groups: value.groups.map((g) => {
        if (g.id !== groupId) return g;
        const i = g.items.indexOf(href);
        const j = i + d;
        if (i < 0 || j < 0 || j >= g.items.length) return g;
        const items = [...g.items];
        [items[i], items[j]] = [items[j]!, items[i]!];
        return { ...g, items };
      }),
    });
  };
  const areaOptions = [...value.groups.map((g) => ({ value: g.id, label: g.name })), { value: LOOSE, label: 'Not in an area' }];

  const Item = ({ href, groupId }: { href: string; groupId: string }) => {
    const c = label(href);
    if (!c) return null;
    const hidden = value.hidden.includes(href);
    return (
      <li
        draggable
        onDragStart={() => setDrag(href)}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (drag && drag !== href) moveTo(drag, groupId, href);
          setDrag(null);
        }}
        className={cx('flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2', drag === href && 'opacity-50', hidden && 'opacity-60')}
      >
        <span aria-hidden="true" className="cursor-grab text-muted">
          ⠿
        </span>
        <span className="w-5 text-center" aria-hidden="true">
          {c.icon}
        </span>
        <span className="min-w-32 flex-1 text-ink">{c.label}</span>
        {groupId !== LOOSE && (
          <>
            <Button type="button" variant="ghost" aria-label={`Move ${c.label} up`} onClick={() => nudge(groupId, href, -1)}>
              ↑
            </Button>
            <Button type="button" variant="ghost" aria-label={`Move ${c.label} down`} onClick={() => nudge(groupId, href, 1)}>
              ↓
            </Button>
          </>
        )}
        <div className="w-44">
          <SelectField label="Area" aria-label={`Area for ${c.label}`} value={groupId} onChange={(e) => moveTo(href, e.target.value)} options={areaOptions} />
        </div>
        {mode === 'personal' && <Checkbox label="Hide" checked={hidden} onChange={(v) => onChange({ ...value, hidden: v ? [...value.hidden, href] : value.hidden.filter((x) => x !== href) })} />}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {value.groups.map((g, gi) => (
        <section
          key={g.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag) moveTo(drag, g.id);
            setDrag(null);
          }}
          className="rounded-xl border-2 border-dashed border-line p-3"
        >
          <div className="mb-2 flex flex-wrap items-end gap-2">
            {mode === 'admin' ? (
              <div className="flex-1">
                <TextField label="Area name" value={g.name} onChange={(e) => onChange({ ...value, groups: value.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })} />
              </div>
            ) : null}
            {mode === 'admin' ? (
              <div className="w-24">
                <TextField label="Symbol" placeholder={areaIcon(g.name)} maxLength={8} value={g.icon ?? ''} onChange={(e) => onChange({ ...value, groups: value.groups.map((x) => (x.id === g.id ? { ...x, icon: e.target.value || undefined } : x)) })} />
              </div>
            ) : (
              <p className="flex-1 font-semibold text-ink">{g.name}</p>
            )}
            <Button type="button" variant="ghost" aria-label="Move area up" disabled={gi === 0} onClick={() => onChange({ ...value, groups: value.groups.map((x, i, a) => (i === gi - 1 ? a[gi]! : i === gi ? a[gi - 1]! : x)) })}>
              ↑
            </Button>
            {mode === 'admin' && (
              <Button type="button" variant="ghost" onClick={() => onChange({ ...value, groups: value.groups.filter((x) => x.id !== g.id) })}>
                Remove area
              </Button>
            )}
          </div>
          {g.items.length === 0 && <p className="text-sm text-muted">Drag items here.</p>}
          <ul className="flex flex-col gap-1">
            {g.items.map((href) => (
              <Item key={href} href={href} groupId={g.id} />
            ))}
          </ul>
        </section>
      ))}
      {mode === 'admin' && (
        <div>
          <Button type="button" variant="secondary" onClick={() => onChange({ ...value, groups: [...value.groups, { id: `g${Date.now().toString(36)}`, name: 'New area', items: [] }] })}>
            + Add an area
          </Button>{' '}
          {value.groups.length === 0 && (
            <Button type="button" variant="secondary" onClick={() => onChange({ ...value, groups: defaultAreas([{ href: '/', label: 'Home' }, ...catalog]) })}>
              Start from the standard areas (Project, Yard, HQ, Procurement, Admin)
            </Button>
          )}
        </div>
      )}
      <section
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (drag) moveTo(drag, LOOSE);
          setDrag(null);
        }}
        className="rounded-xl border border-line p-3"
      >
        <p className="mb-2 font-semibold text-ink">Not in an area (shown under “More”)</p>
        <ul className="flex flex-col gap-1">
          {loose.map((href) => (
            <Item key={href} href={href} groupId={LOOSE} />
          ))}
        </ul>
      </section>
    </div>
  );
}
