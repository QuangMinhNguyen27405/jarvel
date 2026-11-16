import type { AgentProgress, AgentStatus, PlanRecord } from '@jarvel/shared';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { PlanApi } from './api.js';
import { buildProgress, dateRange, dateTime, money } from './format.js';
import { ArrowLeftIcon, CheckIcon, CrossIcon, DotsIcon, PersonIcon, PlaneIcon, PlusIcon, RouteArrow } from './icons.js';
import { Itinerary } from './Itinerary.js';
import { Alert, errorText, Loading, Stamp } from './ui.js';

function StepDot({ status }: { status: AgentStatus }) {
  if (status === 'done') return <CheckIcon size={16} />;
  if (status === 'running') return <PlaneIcon size={16} heading={90} />;
  if (status === 'failed') return <CrossIcon size={14} />;
  return null;
}

/** The five build steps as stops on a route; the solid line runs to the last step that started. */
function RouteLine({ progress }: { progress: AgentProgress[] | undefined }) {
  const { steps, reached } = buildProgress(progress);
  const style = { '--reached': `${Math.max(reached, 0) * 20}%` } as CSSProperties;
  return (
    <div className="route-line" style={style}>
      <ol className="route-steps">
        {steps.map((step) => (
          <li key={step.agent} className={`route-step route-step--${step.status}`} aria-label={step.aria}>
            <span className="route-dot" aria-hidden="true">
              <StepDot status={step.status} />
            </span>
            <span className="route-label">{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Building({ plan }: { plan: PlanRecord }) {
  const { reached } = buildProgress(plan.progress);
  return (
    <section className="card build" aria-labelledby="build-title">
      <div className="build-head">
        <h2 id="build-title" className="card-title">
          {plan.status === 'QUEUED' ? 'Waiting to start' : 'Building your plan'}
        </h2>
        {reached >= 0 && <span className="build-count">{reached + 1} of 5</span>}
      </div>
      <RouteLine progress={plan.progress} />
    </section>
  );
}

function Failed({ plan, onNew }: { plan: PlanRecord; onNew: () => void }) {
  const started = Array.isArray(plan.progress) && plan.progress.length > 0;
  return (
    <section className="card failed" aria-labelledby="failed-title">
      <div className="failed-text">
        <h2 id="failed-title" className="card-title">
          This plan could not be built
        </h2>
        {plan.error && <p>{plan.error}</p>}
      </div>
      {started && <RouteLine progress={plan.progress} />}
      <button type="button" className="btn btn-primary failed-new" onClick={onNew}>
        <PlusIcon />
        New trip
      </button>
    </section>
  );
}

function Travelers({ count }: { count: unknown }) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return null;
  return (
    <span className="chip" role="img" aria-label={`${count} ${count === 1 ? 'traveler' : 'travelers'}`}>
      <PersonIcon size={14} />
      {count}
    </span>
  );
}

export function PlanDetail({
  api,
  planId,
  onBack,
  onNew,
}: {
  api: PlanApi;
  planId: string;
  onBack: () => void;
  onNew: () => void;
}) {
  const [plan, setPlan] = useState<PlanRecord>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const unfinished = plan === undefined || plan.status === 'QUEUED' || plan.status === 'RUNNING';
  useEffect(() => {
    if (!unfinished && !error) return;
    let stopped = false;
    const load = () =>
      api
        .get(planId)
        .then((result) => !stopped && (setPlan(result), setError(undefined)))
        .catch((e: unknown) => !stopped && setError(errorText(e)));
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [api, planId, unfinished, error]);
  async function rename(event: FormEvent) {
    event.preventDefault();
    try {
      setPlan(await api.rename(planId, draft));
      setEditing(false);
      setError(undefined);
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function remove() {
    try {
      await api.remove(planId);
      onBack();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const back = (
    <button type="button" className="back-btn" aria-label="All trips" onClick={onBack}>
      <ArrowLeftIcon size={18} />
    </button>
  );
  if (!plan) {
    return (
      <div className="plan-detail">
        <div className="trip-head">
          <div className="trip-head-main">{back}</div>
        </div>
        {error && <Alert>{error}</Alert>}
        {!error && <Loading />}
      </div>
    );
  }
  const ready = plan.status === 'SUCCEEDED' && plan.itinerary !== undefined;
  const request: Partial<PlanRecord['request']> = plan.request ?? {};
  const arrival = typeof request.arrival === 'string' ? request.arrival : '';
  const departure = typeof request.departure === 'string' ? request.departure : '';
  const total = ready ? money(plan.itinerary?.costs?.total) : '';
  return (
    <div className={`plan-detail${ready ? ' plan-detail--ready' : ''}`}>
      <section className={`trip-head${ready ? ' trip-head--ticket' : ''}`} aria-labelledby="trip-title">
        <div className="trip-head-main">
          {back}
          <div className="trip-head-text">
            {editing ? (
              <form className="rename" onSubmit={rename}>
                <input
                  className="rename-input"
                  aria-label="Plan title"
                  value={draft}
                  maxLength={120}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <h1 id="trip-title" className="trip-head-title">
                {plan.title}
              </h1>
            )}
            <p className="trip-head-meta">
              <Stamp status={plan.status} className="trip-head-stamp" />
              {arrival && departure && (
                <>
                  <span className="trip-head-dates trip-head-dates--long">
                    <span>{dateTime(arrival)}</span>
                    <RouteArrow className="route-arrow" width={64} />
                    <span>{dateTime(departure)}</span>
                  </span>
                  <span className="trip-head-dates trip-head-dates--short">{dateRange(arrival, departure)}</span>
                </>
              )}
              <Travelers count={request.travelers} />
              {total && <span className="trip-head-total">{total} each</span>}
            </p>
          </div>
          {ready && (
            <button
              type="button"
              className="more-btn"
              aria-label="More"
              aria-expanded={menuOpen}
              aria-controls="trip-actions"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <DotsIcon />
            </button>
          )}
        </div>
        <div className="trip-head-side">
          {ready && <Stamp status={plan.status} round className="trip-head-round" />}
          <div id="trip-actions" className="trip-actions" data-open={menuOpen ? 'true' : 'false'}>
            {confirmDelete ? (
              <div className="confirm" role="group" aria-labelledby="confirm-delete">
                <span id="confirm-delete" className="confirm-text">
                  Delete this trip?
                </span>
                <button type="button" className="btn btn-danger" onClick={remove}>
                  Yes, delete
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <>
                {!editing && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDraft(plan.title);
                      setEditing(true);
                      setMenuOpen(false);
                    }}
                  >
                    Rename
                  </button>
                )}
                <button type="button" className="btn btn-danger-quiet" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      {error && <Alert>{error}</Alert>}
      {(plan.status === 'QUEUED' || plan.status === 'RUNNING') && <Building plan={plan} />}
      {plan.status === 'FAILED' && <Failed plan={plan} onNew={onNew} />}
      {ready && <Itinerary plan={plan} />}
    </div>
  );
}
