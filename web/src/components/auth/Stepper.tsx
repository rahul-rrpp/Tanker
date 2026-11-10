import clsx from 'clsx';
import { Check } from 'lucide-react';

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label="Registration progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={clsx(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                done && 'bg-brand-600 text-white',
                active && 'bg-brand-600 text-white ring-4 ring-brand-100',
                !done && !active && 'bg-slate-200 text-muted',
              )}
            >
              {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span className={clsx('hidden text-sm font-medium sm:block', active ? 'text-ink' : 'text-muted')}>{label}</span>
            <span className="sr-only">{done ? '(completed)' : active ? '(current)' : ''}</span>
            {i < steps.length - 1 && <span className={clsx('h-px flex-1', done ? 'bg-brand-600' : 'bg-line')} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
