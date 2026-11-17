import type { DayPlan, Itinerary as ItineraryData, ItineraryItem, PlanRecord } from '@jarvel/shared';
import { useMemo, useState } from 'react';
import { dayParts, money, transitSummary } from './format.js';
import { ChevronIcon, HeartIcon, PlaneIcon, WalkIcon } from './icons.js';
import { dayMap } from './map.js';
import { TripMap } from './TripMap.js';

type Pane = 'itinerary' | 'map' | 'notes';

const PANES: [Pane, string][] = [
  ['itinerary', 'Itinerary'],
  ['map', 'Map'],
  ['notes', 'Notes'],
];

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string' && line.trim() !== '') : [];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * A day as the timeline and the map read it: items is always a list, and a location without usable coordinates is
 * dropped, so the numbers in the timeline and on the map come from the same items and nothing on the map can break.
 */
function usableDay(day: DayPlan): DayPlan {
  const items = (Array.isArray(day.items) ? day.items : []).filter(
    (item): item is ItineraryItem => typeof item === 'object' && item !== null,
  );
  return {
    ...day,
    items: items.map((item) =>
      item.location && !(finite(item.location.lat) && finite(item.location.lng))
        ? { ...item, location: undefined }
        : item,
    ),
  };
}

function Marker({ item, number }: { item: ItineraryItem; number: string | undefined }) {
  if (item.kind === 'hotel') return <span className="tl-dot tl-dot--hotel">H</span>;
  if (item.kind === 'airport')
    return (
      <span className="tl-dot tl-dot--airport">
        <PlaneIcon size={13} />
      </span>
    );
  if (number) return <span className="tl-dot tl-dot--stop">{number}</span>;
  return <span className="tl-dot tl-dot--plain" />;
}

function StopRow({ item, number }: { item: ItineraryItem; number: string | undefined }) {
  const cost = money(item.cost);
  const end = text(item.end);
  const description = text(item.description);
  const lead = [end ? `Until ${end}.` : '', description].filter(Boolean).join(' ');
  const tip = text(item.bookingTip);
  const summary = (
    <>
      <span className="tl-title">{item.title}</span>
      {item.isWishlist === true && (
        <span className="tl-wish" data-testid="wishlist-stop">
          <HeartIcon size={15} />
          <span className="sr-only">From your list</span>
        </span>
      )}
      {cost && <span className="tl-cost">{cost}</span>}
    </>
  );
  return (
    <li className="tl-row tl-row--stop">
      <span className="tl-time">{item.start}</span>
      <span className="tl-marker" aria-hidden="true">
        <Marker item={item} number={number} />
      </span>
      {lead || tip ? (
        <details className="tl-details">
          <summary className="tl-summary">
            {summary}
            <ChevronIcon className="chev" size={14} />
          </summary>
          <div className="tl-more">
            {lead && <p>{lead}</p>}
            {tip && <p>{tip}</p>}
          </div>
        </details>
      ) : (
        <div className="tl-summary tl-summary--still">{summary}</div>
      )}
    </li>
  );
}

function TransitRow({ item }: { item: ItineraryItem }) {
  const time = <span className="tl-time tl-time--minor">{item.start}</span>;
  const rail = <span className="tl-marker" aria-hidden="true" />;
  const leg = item.transit;
  if (!leg || typeof leg !== 'object') {
    return (
      <li className="tl-row tl-row--transit tl-row--walk">
        {time}
        {rail}
        <p className="tl-walk">{item.title}</p>
      </li>
    );
  }
  const summary = transitSummary(leg);
  if (summary.kind === 'walk') {
    return (
      <li className="tl-row tl-row--transit tl-row--walk">
        {time}
        {rail}
        <p className="tl-walk">
          <span className="chip" role="img" aria-label={`Walk ${summary.minutes}`.trim()}>
            <WalkIcon size={16} />
            {summary.minutes}
          </span>
        </p>
      </li>
    );
  }
  const reason = summary.kind === 'rideshare' ? text(leg.rideshareReason) : '';
  return (
    <li className="tl-row tl-row--transit tl-row--ride">
      {time}
      {rail}
      <details className="ride" data-line={summary.family ?? 'none'}>
        <summary className="ride-summary">
          <span className="ride-text">{summary.text}</span>
          {summary.minutes && <span className="ride-mins">{summary.minutes}</span>}
          <ChevronIcon className="chev" size={14} />
        </summary>
        <div className="ride-more">
          {reason && <p>{reason}</p>}
          {summary.steps.length > 0 && (
            <ol className="ride-steps">
              {summary.steps.map((step, index) => (
                <li key={`${index}:${step}`}>{step}</li>
              ))}
            </ol>
          )}
          {summary.fare && <p className="ride-fare">{summary.fare}</p>}
        </div>
      </details>
    </li>
  );
}

function Timeline({ day }: { day: DayPlan }) {
  const numbers = new Map(
    dayMap(day)
      .stops.filter((stop) => stop.kind === 'stop')
      .map((stop) => [stop.id, stop.label]),
  );
  return (
    <div className="timeline">
      <span className="timeline-rail" aria-hidden="true" />
      <ol className="timeline-list">
        {day.items.map((item, index) =>
          item.transit || item.kind === 'transit' ? (
            <TransitRow key={`${index}:${item.id}`} item={item} />
          ) : (
            <StopRow key={`${index}:${item.id}`} item={item} number={numbers.get(item.id)} />
          ),
        )}
      </ol>
    </div>
  );
}

/** What the plan left out, how to get around, and the sample-data disclaimer when the plan has one. */
function Notes({ itinerary }: { itinerary: ItineraryData }) {
  const disclaimer = text(itinerary.disclaimer);
  const unscheduled = (Array.isArray(itinerary.unscheduled) ? itinerary.unscheduled : []).filter(
    (entry) => typeof entry === 'object' && entry !== null,
  );
  const transitBrief = strings(itinerary.transitBrief);
  const passAdvice = text(itinerary.costs?.transitPassAdvice);
  const hasGettingAround = transitBrief.length > 0 || passAdvice !== '';
  if (!disclaimer && unscheduled.length === 0 && !hasGettingAround) return null;
  return (
    <div className="card notes">
      {unscheduled.length > 0 && (
        <details className="note" data-testid="unscheduled">
          <summary className="note-summary">
            <h3 className="note-title">Not scheduled</h3>
            <span className="count-tag">{unscheduled.length}</span>
            <ChevronIcon className="chev" size={16} />
          </summary>
          <div className="note-body">
            <ul className="note-list note-list--plain">
              {unscheduled.map((entry, index) => (
                <li key={`${index}:${entry.name}`}>
                  <strong>{entry.name}</strong> <span className="muted">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      {hasGettingAround && (
        <details className="note">
          <summary className="note-summary">
            <h3 className="note-title">Getting around</h3>
            <ChevronIcon className="chev" size={16} />
          </summary>
          <div className="note-body">
            {transitBrief.length > 0 && (
              <ul className="note-list">
                {transitBrief.map((line, index) => (
                  <li key={`${index}:${line}`}>{line}</li>
                ))}
              </ul>
            )}
            {passAdvice && <p>{passAdvice}</p>}
          </div>
        </details>
      )}
      {disclaimer && <p className="note-fine notes-fine">{disclaimer}</p>}
    </div>
  );
}

/**
 * A ready plan, one day at a time. From 900px wide the timeline sits beside the map and the notes; below that a
 * segmented control shows one of them at a time.
 */
export function Itinerary({ plan }: { plan: PlanRecord }) {
  const itinerary = plan.itinerary as ItineraryData;
  const days = (Array.isArray(itinerary.days) ? itinerary.days : []).filter(
    (day): day is DayPlan => typeof day === 'object' && day !== null,
  );
  const [dayIndex, setDayIndex] = useState(0);
  const [pane, setPane] = useState<Pane>('itinerary');
  const selected = days[Math.min(dayIndex, days.length - 1)];
  // Kept stable between renders, so the map is not handed a "new" day when only the pane changes.
  const day = useMemo(() => (selected ? usableDay(selected) : undefined), [selected]);
  const parts = day ? dayParts(day.date) : undefined;
  const walking = finite(day?.walkingMinutes) && day.walkingMinutes >= 0 ? `${day.walkingMinutes} min` : '';
  const cost = money(day?.cost);
  const fromList = day?.items.some((item) => item.isWishlist === true) ?? false;
  const mapped = day ? dayMap(day).stops.length > 0 : false;
  return (
    <div className="itinerary" data-pane={pane}>
      <div className="plan-nav">
        <div className="segmented pane-switch" role="group" aria-label="Show">
          {PANES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="segmented-btn"
              aria-pressed={pane === value}
              onClick={() => setPane(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {days.length > 0 && (
          <nav className="day-tabs" aria-label="Days">
            {days.map((item, index) => {
              const tab = dayParts(item.date);
              const current = item === selected;
              return (
                <button
                  key={`${index}:${item.date}`}
                  type="button"
                  className="day-tab"
                  aria-current={current ? 'true' : undefined}
                  aria-label={tab.label}
                  onClick={() => setDayIndex(index)}
                >
                  <span className="day-tab-hole" aria-hidden="true" />
                  {tab.weekday && <span className="day-tab-wk">{tab.weekday}</span>}
                  <span className="day-tab-num">{tab.day}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
      <div className="plan-body">
        {day && (
          <section className="plan-pane plan-pane--itinerary day" aria-labelledby="day-title">
            <div className="day-card">
              <div className="day-head">
                <h2 id="day-title" className="day-theme">
                  {text(day.theme) || parts?.label}
                </h2>
                {(walking || cost) && (
                  <div className="day-meta">
                    {walking && (
                      <span className="chip" role="img" aria-label={`${walking} walking`}>
                        <WalkIcon size={16} />
                        {walking}
                      </span>
                    )}
                    {cost && (
                      <span className="chip chip--num" role="img" aria-label={`${cost} per person`}>
                        {cost}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Timeline day={day} />
            </div>
            {fromList && (
              <p className="wish-key">
                <HeartIcon size={13} />
                From your list
              </p>
            )}
          </section>
        )}
        <div className="plan-side">
          {day && (
            <div className="plan-pane plan-pane--map">
              {mapped ? <TripMap key={day.date} day={day} /> : <p className="muted pane-empty">No map for this day</p>}
            </div>
          )}
          <div className="plan-pane plan-pane--notes">
            <Notes itinerary={itinerary} />
          </div>
        </div>
      </div>
    </div>
  );
}
