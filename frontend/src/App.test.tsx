import type { PlanRecord, PlanSummary, TransitLeg } from '@jarvel/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createPlanApi, type PlanApi } from './api.js';
import { App } from './App.js';

// jsdom cannot draw a real map, so react-leaflet is replaced by plain elements that show what the map would hold.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: ({ attribution }: { attribution: string }) => <span data-testid="tiles" data-attribution={attribution} />,
  Polyline: ({ positions }: { positions: unknown[] }) => <span data-testid="line" data-points={positions.length} />,
  Marker: ({ title, children }: { title: string; children?: ReactNode }) => (
    <span data-testid="marker" title={title}>
      {children}
    </span>
  ),
  Popup: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  // The map's resize helper asks for the map; jsdom has no ResizeObserver, so it never calls these.
  useMap: () => ({ getContainer: () => document.createElement('div'), invalidateSize: () => {}, fitBounds: () => {} }),
}));

afterEach(cleanup);

const session = { label: 'amy', getToken: async () => 'dev-amy', signOut: vi.fn() };

function record(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    userId: 'u',
    planId: '00000000-0000-4000-8000-000000000001',
    version: 1,
    status: 'SUCCEEDED',
    title: 'Trip A',
    request: { arrival: '2026-11-18T10:00', departure: '2026-11-21T15:00', travelers: 2 },
    itinerary: {
      summary: 'A lovely trip',
      days: [
        {
          date: '2026-11-18',
          theme: 'Arrival',
          items: [{ id: 'i1', start: '10:00', end: '11:00', title: 'Library', description: 'Books' }],
        },
      ],
      safetyBrief: ['Stay aware'],
      costs: { total: { low: 10, high: 20 } },
    },
    ...overrides,
  } as unknown as PlanRecord;
}

/** An in-memory PlanApi behaving like the server, for the whole CRUD flow. */
function fakeApi(initial: PlanRecord[] = []) {
  const plans = new Map(initial.map((p) => [p.planId, p]));
  const api: PlanApi = {
    list: async () =>
      [...plans.values()].map(
        (p): PlanSummary => ({
          planId: p.planId,
          title: p.title,
          status: p.status,
          version: 1,
          createdAt: '',
          updatedAt: '',
          arrival: p.request.arrival,
          departure: p.request.departure,
        }),
      ),
    get: async (id) => {
      const plan = plans.get(id);
      if (!plan) throw new ApiError(404, { error: 'No such plan.' });
      return plan;
    },
    create: vi.fn(async (input) => {
      const plan = record({ planId: '00000000-0000-4000-8000-000000000002', title: input.title ?? 'New' });
      plans.set(plan.planId, plan);
      return { planId: plan.planId, version: 1, status: 'QUEUED' as const };
    }),
    rename: async (id, title) => {
      const plan = { ...plans.get(id)!, title };
      plans.set(id, plan);
      return plan;
    },
    remove: async (id) => {
      plans.delete(id);
    },
  };
  return api;
}

describe('App CRUD flow', () => {
  it('lists, opens, renames and deletes a plan', async () => {
    render(<App apiUrl="" session={session} api={fakeApi([record()])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Arrival' })).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Plan title'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText(/No trips yet/)).toBeInTheDocument();
  });

  it('creates a plan from the form and shows it', async () => {
    const api = fakeApi();
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New trip' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fresh' } });
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2026-11-18T10:00' } });
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-11-21T15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeInTheDocument();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fresh',
        travelers: 2,
        wishlist: ['Boston Public Library', 'New England Aquarium', 'Harvard Yard'],
      }),
    );
  });

  it('shows the server\'s field errors when creating fails', async () => {
    const api = fakeApi();
    api.create = async () => {
      throw new ApiError(400, { error: 'The request has invalid fields.', fields: [{ field: 'arrival', message: 'must be in the future' }] });
    };
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New trip' }));
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2020-01-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2020-01-02T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(await screen.findByText('arrival: must be in the future')).toBeInTheDocument();
  });

  it('shows a failed plan\'s reason and a load error', async () => {
    const failed = record({ status: 'FAILED', itinerary: undefined, error: 'Could not build.' });
    render(<App apiUrl="" session={session} api={fakeApi([failed])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    expect(await screen.findByText('Could not build.')).toBeInTheDocument();
  });

  it('reports a failing list call', async () => {
    const api = fakeApi();
    api.list = async () => {
      throw new ApiError(500, { error: 'Something went wrong on our side.' });
    };
    render(<App apiUrl="" session={session} api={api} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'));
  });
});

describe('the trip map (Nov 3 request)', () => {
  const located = (id: string, kind: string, title: string, lat: number, lng: number) => ({
    id,
    kind,
    title,
    start: '10:00',
    end: '11:00',
    description: '',
    location: { lat, lng },
  });

  it('shows one map per day with the hotel, numbered stops, a line and the OpenStreetMap credit', async () => {
    const plan = record({
      itinerary: {
        summary: 'Mapped trip',
        days: [
          {
            date: '2026-11-18',
            theme: 'Arrival',
            items: [located('a', 'hotel', 'Check in', 42.3586, -71.0585), located('b', 'visit', 'Library', 42.35, -71.08)],
          },
          {
            date: '2026-11-19',
            theme: 'Harbor',
            items: [located('c', 'meal', 'Cafe', 42.36, -71.05), located('d', 'hotel', 'Back at hotel', 42.3586, -71.0585)],
          },
        ],
        safetyBrief: [],
        costs: { total: { low: 0, high: 0 } },
      } as unknown as PlanRecord['itinerary'],
    });
    render(<App apiUrl="" session={session} api={fakeApi([plan])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    const first = await screen.findByRole('region', { name: 'Map of Wed, Nov 18' });
    expect(within(first).getAllByTestId('marker').map((m) => m.getAttribute('title'))).toEqual(['Check in', 'Library']);
    expect(within(first).getByText('1. Library')).toBeInTheDocument();
    expect(within(first).getByTestId('line')).toHaveAttribute('data-points', '2');
    expect(within(first).getByTestId('tiles').getAttribute('data-attribution')).toContain('OpenStreetMap');
    // Only the selected day's map is shown: the second day's map appears when that day is picked.
    expect(screen.queryByRole('region', { name: 'Map of Thu, Nov 19' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thu, Nov 19' }));
    const second = await screen.findByRole('region', { name: 'Map of Thu, Nov 19' });
    expect(screen.queryByRole('region', { name: 'Map of Wed, Nov 18' })).not.toBeInTheDocument();
    expect(within(second).getAllByTestId('marker').map((m) => m.getAttribute('title'))).toEqual(['Cafe', 'Back at hotel']);
    expect(within(second).getByText('1. Cafe')).toBeInTheDocument();
    expect(within(second).getByText('H. Back at hotel')).toBeInTheDocument();
    expect(within(second).getByTestId('tiles').getAttribute('data-attribution')).toContain('OpenStreetMap');
  });

  it('shows no map for a day whose items have no location', async () => {
    render(<App apiUrl="" session={session} api={fakeApi([record()])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    expect(await screen.findByText('Library')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });
});

describe('entries that were not scheduled, and stops from the list (Step 15)', () => {
  const withItinerary = (extra: Record<string, unknown>) =>
    record({ itinerary: { ...record().itinerary!, ...extra } as unknown as PlanRecord['itinerary'] });

  it('shows a "Not scheduled" card with each entry and its reason', async () => {
    const plan = withItinerary({
      unscheduled: [
        { name: 'Quin Long - Malatang Hotpot', reason: 'not in the Boston data' },
        { placeId: 'harvard-yard', name: 'Harvard Yard', reason: 'closed on your dates' },
      ],
    });
    render(<App apiUrl="" session={session} api={fakeApi([plan])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    const card = await screen.findByTestId('unscheduled');
    expect(within(card).getByRole('heading', { name: 'Not scheduled' })).toBeInTheDocument();
    const entries = within(card).getAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'Quin Long - Malatang Hotpot not in the Boston data',
      'Harvard Yard closed on your dates',
    ]);
    expect(within(card).getByText('Quin Long - Malatang Hotpot')).toBeInTheDocument();
    expect(within(card).getByText('not in the Boston data')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument(); // the plan itself is still shown
  });

  it('shows no "Not scheduled" card when everything was scheduled', async () => {
    render(<App apiUrl="" session={session} api={fakeApi([withItinerary({ unscheduled: [] })])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Arrival' })).toBeInTheDocument();
    expect(screen.queryByTestId('unscheduled')).not.toBeInTheDocument();
    expect(screen.queryByText('Not scheduled')).not.toBeInTheDocument();
  });

  it('shows no "Not scheduled" card for a plan that has no such list at all', async () => {
    render(<App apiUrl="" session={session} api={fakeApi([record()])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Arrival' })).toBeInTheDocument();
    expect(screen.queryByTestId('unscheduled')).not.toBeInTheDocument();
  });

  it('shows no "Not scheduled" card for a plan that is not finished', async () => {
    const building = record({ status: 'RUNNING', itinerary: undefined });
    render(<App apiUrl="" session={session} api={fakeApi([building])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    expect(await screen.findByRole('heading', { name: 'Trip A' })).toBeInTheDocument();
    expect(screen.queryByTestId('unscheduled')).not.toBeInTheDocument();
  });

  it("marks the stops that come from the traveler's list, and only those", async () => {
    const item = (id: string, title: string, isWishlist?: boolean) => ({
      id,
      start: '10:00',
      end: '11:00',
      title,
      description: '',
      ...(isWishlist === undefined ? {} : { isWishlist }),
    });
    const plan = withItinerary({
      days: [
        {
          date: '2026-11-18',
          theme: 'Arrival',
          items: [item('a', 'Saltie Girl', true), item('b', 'Faneuil Hall', false), item('c', 'Train to the hotel')],
        },
      ],
    });
    render(<App apiUrl="" session={session} api={fakeApi([plan])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trip A' }));
    const marks = await screen.findAllByTestId('wishlist-stop');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('From your list');
    expect(marks[0]!.closest('li')).toHaveTextContent('Saltie Girl');
    expect(screen.getByText('Faneuil Hall').closest('li')).not.toHaveTextContent('From your list');
  });
});

describe('the travel design (Nov 16 redesign)', () => {
  const HOTEL = { lat: 42.3586, lng: -71.0585 };
  const blueLeg: TransitLeg = {
    mode: 'subway',
    fromLabel: 'Logan Airport',
    toLabel: 'My hotel',
    durationMinutes: 24,
    fareUSD: 2.4,
    steps: [
      { kind: 'ride', line: 'shuttle', minutes: 10, instruction: 'Take the free airport shuttle to Airport station' },
      { kind: 'wait', line: 'blue', minutes: 5, instruction: 'Wait about 5 min for the Blue Line' },
      { kind: 'ride', line: 'blue', minutes: 7, instruction: 'Ride the Blue Line toward Bowdoin for 3 stops to State (7 min)' },
      { kind: 'walk', minutes: 2, instruction: '' },
    ],
  };
  const walkLeg: TransitLeg = {
    mode: 'walk',
    fromLabel: 'My hotel',
    toLabel: 'Library',
    durationMinutes: 13,
    fareUSD: 0,
    steps: [{ kind: 'walk', minutes: 13, instruction: 'Walk 13 min from My hotel to Library' }],
  };
  const free = { low: 0, high: 0 };

  /** A finished two-day plan, shaped like the planner's output. */
  function readyPlan(): PlanRecord {
    return record({
      itinerary: {
        summary: 'A lovely trip',
        days: [
          {
            date: '2026-11-18',
            weekday: 'wed',
            theme: 'Arrival + Library',
            walkingMinutes: 42,
            cost: { low: 26, high: 45 },
            paceNote: '',
            safetyGuidance: ['Chinatown: stay on the main streets after dark.'],
            items: [
              { id: 'a', kind: 'airport', start: '10:00', end: '10:30', title: 'Logan Airport', description: 'Collect your bags.', cost: free },
              { id: 't1', kind: 'transit', start: '10:30', end: '10:54', title: 'Logan Airport to My hotel', description: '', cost: free, transit: blueLeg },
              { id: 'h', kind: 'hotel', start: '10:54', end: '11:24', title: 'Check in at My hotel', description: '', cost: free, location: HOTEL },
              { id: 't2', kind: 'transit', start: '11:24', end: '11:37', title: 'My hotel to Library', description: '', cost: free, transit: walkLeg },
              {
                id: 'lib',
                kind: 'visit',
                start: '11:37',
                end: '12:27',
                title: 'Library',
                description: 'A grand reading room.',
                cost: { low: 15, high: 25 },
                isWishlist: true,
                bookingTip: 'Free tours at 11:00.',
                safety: { level: 'low', note: 'Busy and well lit.' },
                location: { lat: 42.3493, lng: -71.0782 },
              },
            ],
          },
          {
            date: '2026-11-19',
            weekday: 'thu',
            theme: 'Harbor',
            walkingMinutes: 14,
            cost: { low: 55, high: 95 },
            paceNote: '',
            safetyGuidance: ['Waterfront: well lit in the evening.'],
            items: [
              { id: 'aq', kind: 'visit', start: '09:30', end: '11:30', title: 'Aquarium', description: 'Penguins.', cost: { low: 30, high: 30 }, location: { lat: 42.3592, lng: -71.0495 } },
            ],
          },
        ],
        safetyBrief: ['Keep your phone out of sight on crowded trains.'],
        transitBrief: ['Buy a CharlieCard at any station.'],
        disclaimer: 'Safety information in this plan is guidance, not a guarantee.',
        unscheduled: [],
        criticIssues: [],
        costs: { total: { low: 178, high: 302 }, transitPassAdvice: 'Single fares are cheaper than a pass.' },
      } as unknown as PlanRecord['itinerary'],
    });
  }

  async function openPlan(plan: PlanRecord, api = fakeApi([plan])) {
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: plan.title }));
    return api;
  }

  it('shows exactly one "New trip" button on an empty list, and one beside a list of trips', async () => {
    render(<App apiUrl="" session={session} api={fakeApi()} />);
    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeInTheDocument();
    expect(screen.getByText('Add your dates, hotel and places. Jarvel plans the rest.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New trip' })).toHaveLength(1);
    cleanup();

    render(<App apiUrl="" session={session} api={fakeApi([record()])} />);
    expect(await screen.findByRole('button', { name: 'Trip A' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New trip' })).toHaveLength(1);
    expect(screen.queryByText('No trips yet')).not.toBeInTheDocument();
  });

  it('shows each trip as a ticket: dates, length and a status stamp in words', async () => {
    const failed = record({
      planId: '00000000-0000-4000-8000-000000000009',
      title: 'Harbor walk',
      status: 'FAILED',
      request: { arrival: '2026-11-30T09:00', departure: '2026-12-02T18:00', travelers: 1 } as PlanRecord['request'],
    });
    const oneDay = record({
      planId: '00000000-0000-4000-8000-000000000010',
      title: 'Museum day',
      status: 'QUEUED',
      request: { arrival: '2026-12-12T09:00', departure: '2026-12-12T20:00', travelers: 1 } as PlanRecord['request'],
    });
    render(<App apiUrl="" session={session} api={fakeApi([record(), failed, oneDay])} />);
    const card = (title: string) => screen.getByRole('button', { name: title }).closest('li')!;
    await screen.findByRole('button', { name: 'Trip A' });
    expect(card('Trip A')).toHaveTextContent('Wed Nov 18');
    expect(card('Trip A')).toHaveTextContent('Sat Nov 21');
    expect(card('Trip A')).toHaveTextContent('4 days');
    expect(within(card('Trip A')).getByText('Ready')).toBeInTheDocument();
    expect(card('Harbor walk')).toHaveTextContent('Mon Nov 30');
    expect(card('Harbor walk')).toHaveTextContent('Wed Dec 2');
    expect(card('Harbor walk')).toHaveTextContent('3 days');
    expect(within(card('Harbor walk')).getByText('Failed')).toBeInTheDocument();
    expect(card('Museum day')).toHaveTextContent('Sat Dec 12');
    expect(card('Museum day')).toHaveTextContent('1 day');
    expect(within(card('Museum day')).queryByRole('img', { name: 'to' })).not.toBeInTheDocument();
    expect(within(card('Museum day')).getByText('Waiting to start')).toBeInTheDocument();
  });

  it('asks before deleting, in place, and keeps the trip on "Keep"', async () => {
    const api = await openPlan(record());
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('group', { name: 'Delete this trip?' });
    expect(within(confirm).getByText('Delete this trip?')).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Delete this trip?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(await api.list()).toHaveLength(1);
  });

  it('shows the ready plan header: travelers, dates, the total each, and a "More" button that opens the actions', async () => {
    await openPlan(readyPlan());
    const header = (await screen.findByRole('heading', { level: 1, name: 'Trip A' })).closest('section')!;
    expect(within(header).getByRole('img', { name: '2 travelers' })).toHaveTextContent('2');
    expect(within(header).getByText('$178–$302 each')).toBeInTheDocument();
    expect(header).toHaveTextContent('Wed Nov 18, 10:00');
    expect(header).toHaveTextContent('Sat Nov 21, 15:00');
    const more = within(header).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(more.getAttribute('aria-controls')!)).toHaveAttribute('data-open', 'true');
  });

  it('shows one day at a time and switches the timeline with the day tabs', async () => {
    await openPlan(readyPlan());
    const wed = await screen.findByRole('button', { name: 'Wed, Nov 18' });
    const thu = screen.getByRole('button', { name: 'Thu, Nov 19' });
    expect(wed).toHaveAttribute('aria-current', 'true');
    expect(thu).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: 'Arrival + Library' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '42 min walking' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '$26–$45 per person' })).toBeInTheDocument();
    expect(screen.queryByText('Aquarium')).not.toBeInTheDocument();

    fireEvent.click(thu);
    expect(thu).toHaveAttribute('aria-current', 'true');
    expect(wed).not.toHaveAttribute('aria-current');
    const day = screen.getByRole('region', { name: 'Harbor' });
    expect(within(day).getByText('Aquarium')).toBeInTheDocument();
    expect(within(day).getByText('$30')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '14 min walking' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Arrival + Library' })).not.toBeInTheDocument();
    expect(screen.queryByText('Logan Airport')).not.toBeInTheDocument();
  });

  it('shows a ride as its line and destination, with the steps and the fare inside, and a walk as its minutes', async () => {
    await openPlan(readyPlan());
    const day = await screen.findByRole('region', { name: 'Arrival + Library' });
    const ride = within(day).getByText('Blue Line to My hotel').closest('details')!;
    expect(ride).toHaveAttribute('data-line', 'blue');
    expect(ride.querySelector('summary')).toHaveTextContent('Blue Line to My hotel24 min');
    expect(within(ride).getAllByRole('listitem').map((step) => step.textContent)).toEqual([
      'Take the free airport shuttle to Airport station',
      'Wait about 5 min for the Blue Line',
      'Ride the Blue Line toward Bowdoin for 3 stops to State (7 min)',
    ]);
    expect(within(ride).getByText('Fare $2.40')).toBeInTheDocument();
    expect(within(day).getByRole('img', { name: 'Walk 13 min' })).toHaveTextContent('13 min');
    expect(within(day).queryByText('Walk 13 min from My hotel to Library')).not.toBeInTheDocument();
  });

  it('numbers a stop like its map pin and opens to its details, tip and safety note', async () => {
    await openPlan(readyPlan());
    const day = await screen.findByRole('region', { name: 'Arrival + Library' });
    const library = within(day).getByText('Library').closest('li')!;
    expect(within(library).getByText('1')).toBeInTheDocument();
    expect(within(library).getByText('$15–$25')).toBeInTheDocument();
    expect(within(library).getByTestId('wishlist-stop')).toHaveTextContent('From your list');
    expect(within(library).getByText('Until 12:27. A grand reading room.')).toBeInTheDocument();
    expect(within(library).getByText('Free tours at 11:00.')).toBeInTheDocument();
    expect(within(library).getByText('Busy and well lit.')).toBeInTheDocument();
    expect(within(within(day).getByText('Check in at My hotel').closest('li')!).getByText('H')).toBeInTheDocument();
    // The map numbers the same stop the same way.
    expect(within(screen.getByRole('region', { name: 'Map of Wed, Nov 18' })).getByText('1. Library')).toBeInTheDocument();
    // The key under the day explains the heart, only on a day that has one.
    expect(screen.getByText('From your list', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thu, Nov 19' }));
    expect(screen.queryByText('From your list', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('keeps the safety notes whole behind "Safety", and the "Safety" button opens them', async () => {
    await openPlan(readyPlan());
    const safety = (await screen.findByRole('heading', { level: 3, name: 'Safety' })).closest('details')!;
    expect(safety).not.toHaveAttribute('open');
    expect(within(safety).getByText('Chinatown: stay on the main streets after dark.')).toBeInTheDocument();
    expect(within(safety).getByText('Keep your phone out of sight on crowded trains.')).toBeInTheDocument();
    expect(within(safety).getByText('Safety information in this plan is guidance, not a guarantee.')).toBeInTheDocument();
    const around = screen.getByRole('heading', { level: 3, name: 'Getting around' }).closest('details')!;
    expect(within(around).getByText('Buy a CharlieCard at any station.')).toBeInTheDocument();
    expect(within(around).getByText('Single fares are cheaper than a pass.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Safety' }));
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Itinerary' })).toHaveAttribute('aria-pressed', 'false');
    expect(safety).toHaveAttribute('open');

    // The day's guidance follows the selected day.
    fireEvent.click(screen.getByRole('button', { name: 'Thu, Nov 19' }));
    expect(within(safety).getByText('Waterfront: well lit in the evening.')).toBeInTheDocument();
    expect(within(safety).queryByText('Chinatown: stay on the main streets after dark.')).not.toBeInTheDocument();
  });

  it('hides what a plan does not have, without printing "undefined"', async () => {
    const sparse = record({
      progress: undefined,
      itinerary: {
        summary: 'old',
        days: [
          {
            date: '2026-11-18',
            theme: 'Arrival',
            items: [
              { id: 'x', kind: 'transit', start: '10:00', end: '10:20', title: 'Hotel to Library', description: '' },
              { id: 'y', start: '10:30', end: '11:00', title: 'Library', description: '' },
            ],
          },
        ],
        safetyBrief: [],
        costs: { total: { low: 0, high: 0 } },
      } as unknown as PlanRecord['itinerary'],
    });
    await openPlan(sparse);
    expect(await screen.findByText('Hotel to Library')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|NaN|null/);
    expect(screen.queryByText(/each$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /walking/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /per person/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Safety' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Getting around' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Safety' })).not.toBeInTheDocument();
  });

  it('shows a waiting plan with every step still to come', async () => {
    await openPlan(record({ status: 'QUEUED', itinerary: undefined, progress: [] }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Waiting to start' })).toBeInTheDocument();
    expect(screen.queryByText(/of 5/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/of 5/);
    for (const step of ['Stops', 'Timing', 'Transit', 'Safety check', 'Final check']) {
      expect(screen.getByLabelText(`${step}: waiting`)).toBeInTheDocument();
    }
  });

  it('shows a plan being built step by step', async () => {
    const running = record({
      status: 'RUNNING',
      itinerary: undefined,
      progress: [
        { agent: 'researcher', status: 'done' },
        { agent: 'scheduler', status: 'done' },
        { agent: 'transit', status: 'running' },
        { agent: 'safety', status: 'pending' },
      ],
    });
    await openPlan(running);
    expect(await screen.findByRole('heading', { level: 2, name: 'Building your plan' })).toBeInTheDocument();
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
    expect(screen.getByLabelText('Stops: done')).toBeInTheDocument();
    expect(screen.getByLabelText('Timing: done')).toBeInTheDocument();
    expect(screen.getByLabelText('Transit: working')).toBeInTheDocument();
    expect(screen.getByLabelText('Safety check: waiting')).toBeInTheDocument();
    expect(screen.getByLabelText('Final check: waiting')).toBeInTheDocument();
    expect(screen.getByText('Building…')).toBeInTheDocument();
  });

  it('shows where a failed plan stopped, its reason, and a way to start a new trip', async () => {
    const failed = record({
      status: 'FAILED',
      itinerary: undefined,
      error: 'We could not build a plan that meets every safety rule for these dates.',
      progress: [
        { agent: 'researcher', status: 'done' },
        { agent: 'scheduler', status: 'done' },
        { agent: 'transit', status: 'done' },
        { agent: 'safety', status: 'failed' },
        { agent: 'critic', status: 'skipped' },
      ],
    });
    await openPlan(failed);
    expect(await screen.findByRole('heading', { level: 2, name: 'This plan could not be built' })).toBeInTheDocument();
    expect(screen.getByText('We could not build a plan that meets every safety rule for these dates.')).toBeInTheDocument();
    expect(screen.getByLabelText('Safety check: stopped here')).toBeInTheDocument();
    expect(screen.getByLabelText('Final check: skipped')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New trip' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'New trip' })).toBeInTheDocument();
  });

  it('shows no steps for a failed plan that never started', async () => {
    await openPlan(record({ status: 'FAILED', itinerary: undefined, error: 'Could not start.', progress: [] }));
    expect(await screen.findByText('Could not start.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Stops:/)).not.toBeInTheDocument();
  });

  it('shows the monthly limit with a used/limit stamp beside the server message', async () => {
    const api = fakeApi();
    const message = 'You have used all 3 plans for this month. The count resets on 2026-12-01.';
    api.create = async () => {
      throw new ApiError(429, { error: message, code: 'quota-exceeded', limit: 3, used: 3, resetsOn: '2026-12-01' } as never);
    };
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New trip' }));
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2026-11-18T10:00' } });
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-11-21T15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent('3/3');
    expect(alert).toHaveTextContent(/plans/i);
    expect(screen.getByRole('button', { name: 'Create plan' })).toBeEnabled();
  });

  it('shows a monthly limit without numbers as the message alone', async () => {
    const api = fakeApi();
    api.create = async () => {
      throw new ApiError(429, { error: 'Too many plans this month.' });
    };
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New trip' }));
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2026-11-18T10:00' } });
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-11-21T15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many plans this month.');
    expect(alert).not.toHaveTextContent('/');
  });

  it('marks the fields the server named, once, and unmarks one when it is changed', async () => {
    const api = fakeApi();
    api.create = async () => {
      throw new ApiError(400, {
        error: 'The request has invalid fields.',
        fields: [
          { field: 'hotel.lat', message: 'must be between -90 and 90' },
          { field: 'departure', message: 'must be after arrival' },
          { field: 'preferences.pace', message: 'is not a pace' },
        ],
      });
    };
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New trip' }));
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2026-11-18T10:00' } });
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-11-17T15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'The request has invalid fields.',
      'hotel.lat: must be between -90 and 90',
      'departure: must be after arrival',
      'preferences.pace: is not a pace',
    ]);
    expect(screen.getAllByText('departure: must be after arrival')).toHaveLength(1);
    expect(screen.getByLabelText('Latitude')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Departure')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radiogroup', { name: 'Pace' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Arrival')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Longitude')).not.toHaveAttribute('aria-invalid');

    fireEvent.input(screen.getByLabelText('Latitude'), { target: { value: '42.36' } });
    expect(screen.getByLabelText('Latitude')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Departure')).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends the pace picked in the segmented control', async () => {
    const api = fakeApi();
    render(<App apiUrl="" session={session} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New trip' }));
    expect(screen.getByRole('radio', { name: 'Moderate' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Packed' }));
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2026-11-18T10:00' } });
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-11-21T15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ preferences: { pace: 'packed' } }));
  });

  it('offers "Try again" when the list cannot be loaded, and loads it again', async () => {
    const api = fakeApi([record()]);
    const list = api.list;
    let calls = 0;
    api.list = async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(500, { error: 'Something went wrong on our side.' });
      return list();
    };
    render(<App apiUrl="" session={session} api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Trip A' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('createPlanApi', () => {
  it('sends the bearer token, JSON body and parses errors', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ error: 'nope', code: 'x' }), { status: 404 }),
    );
    const api = createPlanApi('http://api', async () => 'tok', fetchFn as unknown as typeof fetch);
    await api.remove('1');
    await expect(api.rename('1', 'T')).rejects.toMatchObject({ status: 404, message: 'nope' });
    const [url, init] = fetchFn.mock.calls[1]!;
    expect(url).toBe('http://api/plans/1');
    expect(init).toMatchObject({ method: 'PATCH', body: '{"title":"T"}' });
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});
