import type { PlanRecord } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';
import { escapeMarkdown, renderPlanMarkdown } from '../src/lib/markdown.js';
import { buildItinerary, SAMPLE_DATA_WARNING } from '../src/lib/scheduler.js';
import { hoursOf, sampleDataWith } from './fixtures/data.js';
import { baseSelection } from './fixtures/fake-ai.js';
import { queuedPlan } from './fixtures/plans.js';
import { validTripRequest } from './fixtures/requests.js';

const data = loadBostonData();
const request = validTripRequest({
  wishlist: ['Boston Public Library', 'New England Aquarium', 'Harvard Yard', 'Tatte Bakery'],
});

function succeededPlan(): PlanRecord {
  const itinerary = buildItinerary({
    request,
    data,
    selection: baseSelection(),
    modelId: 'm',
    generatedAt: '2026-10-23T16:00:00Z',
  });
  return queuedPlan({
    status: 'SUCCEEDED',
    request,
    itinerary,
    dataVersion: data.dataVersion,
    sourceCredits: data.sourceCredits,
  });
}

describe('renderPlanMarkdown (FR7.1)', () => {
  it('contains every stop and every leg of the JSON plan (AC5.2.1)', () => {
    const plan = succeededPlan();
    const markdown = renderPlanMarkdown(plan);
    for (const item of plan.itinerary!.days.flatMap((d) => d.items)) {
      expect(markdown).toContain(`${item.start}-${item.end}`);
      if (item.transit) {
        expect(markdown).toContain(
          `${escapeMarkdown(item.transit.fromLabel)} to ${escapeMarkdown(item.transit.toLabel)}`,
        );
        for (const step of item.transit.steps) expect(markdown).toContain(escapeMarkdown(step.instruction));
      } else {
        expect(markdown).toContain(escapeMarkdown(item.title));
      }
    }
  });

  it('includes the sample-data disclaimer, the unscheduled list, data version and credits (AC5.2.2, AC5.1.3)', () => {
    const plan = succeededPlan();
    const markdown = renderPlanMarkdown(plan);
    expect(markdown).toContain(`> ${escapeMarkdown(SAMPLE_DATA_WARNING)}`);
    // The safety rules are not part of this version, so the plan says nothing about safety.
    expect(markdown).not.toMatch(/safety/i);
    // A plan built from hand-checked data has no disclaimer, and no empty quote in its place.
    const checked = { ...plan, itinerary: { ...plan.itinerary!, disclaimer: undefined } };
    expect(renderPlanMarkdown(checked)).not.toContain('\n> ');
    expect(markdown).toContain('Tatte Bakery: not in the Boston data');
    expect(markdown).toContain(data.dataVersion);
    expect(markdown).toContain(escapeMarkdown(data.sourceCredits[0]!));
  });

  it('lists a place that is closed on every trip date with that reason (AC7.3.2)', () => {
    const closed = sampleDataWith((files) => {
      Object.assign(hoursOf(files, 'harvard-yard'), { wed: [], thu: [], fri: [], sat: [] });
    });
    const itinerary = buildItinerary({
      request,
      data: closed,
      selection: baseSelection(),
      modelId: 'm',
      generatedAt: '2026-10-23T16:00:00Z',
    });
    const markdown = renderPlanMarkdown(queuedPlan({ status: 'SUCCEEDED', request, itinerary }));
    expect(markdown).toContain('- Harvard Yard: closed on your dates');
    expect(markdown).toContain('- Tatte Bakery: not in the Boston data');
    expect(markdown).not.toContain('**Harvard Yard**'); // it is not in any day's timeline
  });

  it('shows the status of a plan that is not finished instead of an empty plan (AC5.2.3)', () => {
    const queued = renderPlanMarkdown(queuedPlan());
    expect(queued).toContain('**Status:** QUEUED');
    expect(queued).toContain('still being built');
    const running = renderPlanMarkdown(
      queuedPlan({ status: 'RUNNING', progress: [{ agent: 'researcher', status: 'running' }] }),
    );
    expect(running).toContain('- researcher: running');
  });

  it('shows the plain reason of a failed plan', () => {
    const markdown = renderPlanMarkdown(queuedPlan({ status: 'FAILED', error: 'Your plan took too long.' }));
    expect(markdown).toContain('**Status:** FAILED');
    expect(markdown).toContain('Your plan took too long.');
  });

  it('escapes Markdown characters in traveler text', () => {
    expect(renderPlanMarkdown(queuedPlan({ title: '# <b>Trip</b> *now*' }))).toContain(
      '# \\# \\<b\\>Trip\\</b\\> \\*now\\*',
    );
  });
});
