import type { PlanSummary } from '@jarvel/shared';
import { useCallback, useEffect, useState } from 'react';
import type { PlanApi } from './api.js';
import { isSameDay, shortDate, tripLength } from './format.js';
import { PassportArt, PlusIcon, RouteArrow } from './icons.js';
import { Alert, errorText, Loading, Stamp } from './ui.js';

function NewTripButton({ onNew }: { onNew: () => void }) {
  return (
    <button type="button" className="btn btn-primary" onClick={onNew}>
      <PlusIcon />
      New trip
    </button>
  );
}

/** One trip as a ticket: title and dates on the left, the status stamp and the trip's length on the stub. */
function TripCard({ plan, onOpen }: { plan: PlanSummary; onOpen: (id: string) => void }) {
  const oneDay = isSameDay(plan.arrival, plan.departure);
  const length = tripLength(plan.arrival, plan.departure);
  return (
    <li className="ticket trip-card">
      <div className="trip-card-main">
        <h2 className="trip-card-title">
          {/* The button's hit area is stretched over the whole card; its name stays the title. */}
          <button type="button" className="trip-card-open" onClick={() => onOpen(plan.planId)}>
            {plan.title}
          </button>
        </h2>
        <p className="trip-card-dates">
          <span>{shortDate(plan.arrival)}</span>
          {!oneDay && (
            <>
              <RouteArrow className="route-arrow" />
              <span>{shortDate(plan.departure)}</span>
            </>
          )}
        </p>
      </div>
      <div className="ticket-stub trip-card-stub">
        <Stamp status={plan.status} />
        {length && <span className="trip-card-length">{length}</span>}
      </div>
    </li>
  );
}

export function PlanList({ api, onOpen, onNew }: { api: PlanApi; onOpen: (id: string) => void; onNew: () => void }) {
  const [plans, setPlans] = useState<PlanSummary[] | undefined>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    api
      .list()
      .then((result) => {
        setPlans(result);
        setError(undefined);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [api]);
  useEffect(load, [load]);
  const busy = plans?.some((p) => p.status === 'QUEUED' || p.status === 'RUNNING');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [busy, load]);
  const empty = plans !== undefined && plans.length === 0;
  return (
    <section className="trips" aria-labelledby="trips-title">
      <div className="page-head">
        <h1 id="trips-title" className="page-title">
          Your trips
        </h1>
        {/* The empty state has its own button; there is only ever one "New trip" on screen. */}
        {!empty && (plans !== undefined || error) && <NewTripButton onNew={onNew} />}
      </div>
      {error && (
        <div className="load-error">
          <Alert>{error}</Alert>
          <button type="button" className="btn" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {!plans && !error && <Loading />}
      {empty && (
        <section className="card empty" aria-labelledby="empty-title">
          <PassportArt className="empty-art" />
          <div className="empty-text">
            <h2 id="empty-title" className="empty-title">
              No trips yet
            </h2>
            <p>Add your dates, hotel and places. Jarvel plans the rest.</p>
            <NewTripButton onNew={onNew} />
          </div>
        </section>
      )}
      {plans && plans.length > 0 && (
        <ul className="trip-list">
          {plans.map((plan) => (
            <TripCard key={plan.planId} plan={plan} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}
