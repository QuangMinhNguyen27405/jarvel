import type { PlanStatus } from '@jarvel/shared';
import type { ReactNode } from 'react';
import { ApiError } from './api.js';
import { AlertIcon, FlightPath } from './icons.js';

/** A plain-language message for a failed call: the server's message and its field messages. */
export const errorText = (error: unknown): string => {
  if (error instanceof ApiError) return [error.message, ...error.fieldMessages].join(' ');
  return error instanceof Error ? error.message : 'Something went wrong.';
};

export const STATUS_LABEL: Record<PlanStatus, string> = {
  QUEUED: 'Waiting to start',
  RUNNING: 'Building…',
  SUCCEEDED: 'Ready',
  FAILED: 'Failed',
};

/**
 * A plan's status as a rubber stamp. The word is always there; the colour only repeats it. `round` is the big
 * circular stamp of a ready plan's ticket.
 */
export function Stamp({
  status,
  round = false,
  className,
}: {
  status: PlanStatus;
  round?: boolean;
  className?: string;
}) {
  const classes = ['stamp', `stamp--${status.toLowerCase()}`, round ? 'stamp--round' : '', className ?? ''];
  return <span className={classes.filter(Boolean).join(' ')}>{STATUS_LABEL[status]}</span>;
}

/** The loading line: a plane on a dashed arc, then "Loading…". */
export function Loading({ className }: { className?: string }) {
  return (
    <p className={['loading', className].filter(Boolean).join(' ')} role="status">
      <FlightPath className="loading-path" />
      Loading…
    </p>
  );
}

/** An error message: red text after a small icon, no box. */
export function Alert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={['alert', className].filter(Boolean).join(' ')} role="alert">
      <AlertIcon className="alert-icon" size={18} />
      <span>{children}</span>
    </p>
  );
}
