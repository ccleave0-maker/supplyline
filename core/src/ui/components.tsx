'use client';

import Link from 'next/link';
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { readableTextOn } from '../domain/color';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// Every interactive control is at least 48px tall (≥ 44pt iOS / 48dp Android).
const base =
  'sl-btn inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const variants = {
  primary: 'bg-brand text-brand-fg hover:brightness-95 active:brightness-90',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  danger: 'bg-danger text-danger-fg hover:brightness-95',
  ghost: 'text-brand-ink hover:bg-surface-2',
};
type Variant = keyof typeof variants;

export function Button({
  variant = 'primary',
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} aria-busy={busy || undefined} className={cx(base, variants[variant], className)}>
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx(base, variants[variant], className)}>
      {children}
    </Link>
  );
}

export function Spinner({ small, label = 'Loading' }: { small?: boolean; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', small ? 'h-4 w-4' : 'h-8 w-8')}
    />
  );
}

export function PageLoading() {
  return (
    <div className="flex justify-center py-16 text-brand-ink">
      <Spinner />
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
}

function FieldWrap({ id, label, error, hint, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-danger';

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function TextField(
  { label, error, hint, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint}>
      <input
        ref={ref}
        id={fid}
        aria-invalid={!!error}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={cx(inputClass, className)}
        {...rest}
      />
    </FieldWrap>
  );
});

export function TextArea({ label, error, hint, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint}>
      <textarea id={fid} aria-invalid={!!error} rows={3} className={cx(inputClass, 'py-2')} {...rest} />
    </FieldWrap>
  );
}

export function SelectField({
  label,
  error,
  hint,
  id,
  options,
  placeholder,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { options: { value: string; label: string }[]; placeholder?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint}>
      <select id={fid} aria-invalid={!!error} className={inputClass} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function Checkbox({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-1">
      <input
        id={id}
        type="checkbox"
        className="h-6 w-6 shrink-0 accent-[var(--brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col">
        <span className="text-base text-ink">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4 shadow-sm', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-flex min-h-12 items-center text-base font-semibold text-brand-ink">
            ‹ Back
          </Link>
        )}
        <h1 className="text-2xl font-bold break-words text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-base text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger bg-surface p-3 text-danger">
      <span className="font-medium">{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg bg-warn-bg p-3 text-warn-ink">{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-6 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'ok' | 'danger' }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink border border-line',
    brand: 'bg-brand text-brand-fg',
    ok: 'border border-ok text-ok',
    danger: 'border border-danger text-danger',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold', tones[tone])}>{children}</span>;
}

/** A tappable list row (≥ 56px) that links somewhere. */
export function ListRow({ href, title, subtitle, right }: { href: string; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="sl-row flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
        <span className="min-w-0">
          <span className="sl-row-title block font-semibold break-words text-ink">{title}</span>
          {subtitle && <span className="block text-sm text-muted">{subtitle}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-muted">
          {right}
          <span aria-hidden="true" className="sl-chevron">›</span>
        </span>
      </Link>
    </li>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{children}</ul>;
}

/** Company logo, or a monogram badge in the company colour when no logo is set. */
export function CompanyMark({
  name,
  code,
  logoUrl,
  color,
  size = 40,
}: {
  name: string;
  code: string;
  logoUrl: string | null;
  /** Company theme colour; defaults to the active brand colour */
  color?: string;
  size?: number;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={`${name} logo`} style={{ height: size, maxWidth: size * 3 }} className="object-contain" />;
  }
  return (
    <span
      aria-label={`${name} logo`}
      role="img"
      style={{
        height: size,
        minWidth: size,
        fontSize: size * 0.36,
        ...(color ? { background: color, color: readableTextOn(color) } : {}),
      }}
      className="inline-flex items-center justify-center rounded-lg bg-brand px-1.5 font-black tracking-tight text-brand-fg"
    >
      {code}
    </span>
  );
}

/** Tap to call (phones open the dialer; PCs hand off to Teams/Skype/etc.). */
export function PhoneLink({ number, className }: { number: string | null | undefined; className?: string }) {
  if (!number) return null;
  return (
    <a href={`tel:${number.replace(/[^\d+]/g, '')}`} className={cx('font-semibold text-brand-ink underline-offset-2 hover:underline', className)}>
      {number}
    </a>
  );
}

/** Tap to email. */
export function EmailLink({ email, className }: { email: string | null | undefined; className?: string }) {
  if (!email) return null;
  return (
    <a href={`mailto:${email}`} className={cx('font-semibold break-all text-brand-ink underline-offset-2 hover:underline', className)}>
      {email}
    </a>
  );
}
