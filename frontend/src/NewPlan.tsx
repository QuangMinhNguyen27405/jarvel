import type { QuotaExceededBody } from '@jarvel/shared';
import { useState, type FormEvent } from 'react';
import { ApiError, type CreatePlanInput, type PlanApi } from './api.js';
import { AlertIcon, PlaneIcon } from './icons.js';
import { errorText } from './ui.js';

const PACES = [
  ['relaxed', 'Relaxed'],
  ['moderate', 'Moderate'],
  ['packed', 'Packed'],
] as const;

/** Which form field an API field path names ("hotel.lat" is the Latitude field, "wishlist.2" the wishlist). */
const FIELD_INPUT: [path: string, input: string][] = [
  ['arrival', 'arrival'],
  ['departure', 'departure'],
  ['travelers', 'travelers'],
  ['title', 'title'],
  ['notes', 'notes'],
  ['wishlist', 'wishlist'],
  ['hotel.name', 'hotelName'],
  ['hotel.address', 'hotelAddress'],
  ['hotel.lat', 'lat'],
  ['hotel.lng', 'lng'],
  ['preferences.pace', 'pace'],
];

export function inputForField(path: string): string | undefined {
  return FIELD_INPUT.find(([key]) => path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`))?.[1];
}

function invalidInputs(error: unknown): Set<string> {
  if (!(error instanceof ApiError)) return new Set();
  const fields = Array.isArray(error.body.fields) ? error.body.fields : [];
  const names = fields.map((f) => (typeof f?.field === 'string' ? inputForField(f.field) : undefined));
  return new Set(names.filter((name): name is string => name !== undefined));
}

interface QuotaNotice {
  message: string;
  used?: number;
  limit?: number;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The monthly-limit answer (429): the round "used/limit PLANS" stamp beside the server's message. */
function MonthlyLimit({ notice }: { notice: QuotaNotice }) {
  const counted = notice.used !== undefined && notice.limit !== undefined;
  return (
    <div className="quota" role="alert">
      {counted ? (
        <span className="quota-stamp" aria-hidden="true">
          <span className="quota-count">
            {notice.used}/{notice.limit}
          </span>
          <span className="quota-unit">plans</span>
        </span>
      ) : (
        <AlertIcon className="alert-icon" size={18} />
      )}
      <p className="quota-text">{notice.message}</p>
    </div>
  );
}

export function NewPlan({
  api,
  onCancel,
  onCreated,
}: {
  api: PlanApi;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<Set<string>>(() => new Set());
  const [quota, setQuota] = useState<QuotaNotice>();
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const input: CreatePlanInput = {
      ...(text('title') ? { title: text('title') } : {}),
      arrival: text('arrival'),
      departure: text('departure'),
      travelers: Number(text('travelers')),
      hotel: {
        name: text('hotelName'),
        address: text('hotelAddress'),
        lat: Number(text('lat')),
        lng: Number(text('lng')),
      },
      wishlist: text('wishlist')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      ...(text('notes') ? { notes: text('notes') } : {}),
      preferences: { pace: text('pace') as 'relaxed' | 'moderate' | 'packed' },
    };
    setSaving(true);
    setErrors([]);
    setInvalid(new Set());
    setQuota(undefined);
    try {
      const created = await api.create(input);
      onCreated(created.planId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const body = e.body as Partial<QuotaExceededBody>;
        setQuota({ message: errorText(e), used: count(body.used), limit: count(body.limit) });
      } else {
        setErrors(
          e instanceof ApiError && e.fieldMessages.length > 0 ? [e.message, ...e.fieldMessages] : [errorText(e)],
        );
        setInvalid(invalidInputs(e));
      }
      setSaving(false);
    }
  }
  /** A field the server named stops looking wrong once it is changed. */
  function edited(event: FormEvent<HTMLFormElement>) {
    const name = (event.target as { name?: unknown }).name;
    if (typeof name !== 'string' || !invalid.has(name)) return;
    setInvalid((current) => {
      const next = new Set(current);
      next.delete(name);
      return next;
    });
  }
  const mark = (name: string) => (invalid.has(name) ? { 'aria-invalid': true } : {});
  return (
    <form className="card new-trip" onSubmit={submit} onInput={edited} aria-labelledby="new-trip-title">
      <div className="new-trip-head">
        <h1 id="new-trip-title" className="page-title">
          New trip
        </h1>
        <label className="field new-trip-title-field">
          <span className="field-label">Title</span>
          <input name="title" maxLength={120} placeholder="Optional" {...mark('title')} />
        </label>
      </div>
      <div className="new-trip-body">
        <div className="new-trip-main">
          <fieldset className="form-group">
            <legend className="form-legend">When and who</legend>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Arrival</span>
                <input name="arrival" type="datetime-local" required {...mark('arrival')} />
              </label>
              <label className="field">
                <span className="field-label">Departure</span>
                <input name="departure" type="datetime-local" required {...mark('departure')} />
              </label>
            </div>
            <div className="form-grid form-grid--who">
              <label className="field">
                <span className="field-label">Travelers</span>
                <input
                  name="travelers"
                  type="number"
                  min={1}
                  max={6}
                  defaultValue={2}
                  required
                  {...mark('travelers')}
                />
              </label>
              <div className="field">
                <span className="field-label" id="pace-label">
                  Pace
                </span>
                <div className="segmented" role="radiogroup" aria-labelledby="pace-label" {...mark('pace')}>
                  {PACES.map(([value, label]) => (
                    <label key={value} className="segmented-option">
                      <input type="radio" name="pace" value={value} defaultChecked={value === 'moderate'} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>
          <fieldset className="form-group">
            <legend className="form-legend">Where you stay</legend>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Hotel name</span>
                <input name="hotelName" defaultValue="My hotel" required {...mark('hotelName')} />
              </label>
              <label className="field">
                <span className="field-label">Address</span>
                <input name="hotelAddress" defaultValue="1 Example St, Boston" required {...mark('hotelAddress')} />
              </label>
            </div>
            <div className="form-grid form-grid--pair">
              <label className="field">
                <span className="field-label">Latitude</span>
                <input
                  className="mono"
                  name="lat"
                  type="number"
                  step="any"
                  defaultValue={42.3586}
                  required
                  {...mark('lat')}
                />
              </label>
              <label className="field">
                <span className="field-label">Longitude</span>
                <input
                  className="mono"
                  name="lng"
                  type="number"
                  step="any"
                  defaultValue={-71.0585}
                  required
                  {...mark('lng')}
                />
              </label>
            </div>
          </fieldset>
        </div>
        <div className="new-trip-side">
          <fieldset className="form-group">
            <legend className="form-legend">Places to go</legend>
            <label className="field">
              <span className="field-label">
                Wishlist <span className="field-hint">one per line</span>
              </span>
              <textarea
                className="lined"
                name="wishlist"
                rows={5}
                defaultValue={'Boston Public Library\nNew England Aquarium\nHarvard Yard'}
                {...mark('wishlist')}
              />
            </label>
            <label className="field">
              <span className="field-label">Notes</span>
              <textarea name="notes" rows={2} maxLength={1000} placeholder="Optional" {...mark('notes')} />
            </label>
          </fieldset>
          {quota && <MonthlyLimit notice={quota} />}
          {errors.length > 0 && (
            <ul className="form-errors" role="alert">
              {errors.map((message, index) => (
                <li key={`${index}:${message}`}>
                  {index === 0 && <AlertIcon className="alert-icon" />}
                  {message}
                </li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create plan'}
              <PlaneIcon heading={90} />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
