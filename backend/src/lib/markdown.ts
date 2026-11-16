// Renders a plan as readable Markdown with the same content as the JSON (FR7.1, US5.2): days, times, stops,
// transit legs with their steps, safety guidance, the disclaimer, the unscheduled list, data version and credits.
// A plan that is not finished renders as its status instead of an empty plan (AC5.2.3).
import type { DayPlan, ItineraryItem, Money, PlanRecord } from '@jarvel/shared';

/** Escapes characters that Markdown would treat as formatting, so data text is shown as written. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#|!])/g, '\\$1').replace(/\r?\n/g, ' ');
}

function money(value: Money): string {
  if (value.low === 0 && value.high === 0) return 'free';
  return value.low === value.high ? `$${value.low.toFixed(2)}` : `$${value.low.toFixed(2)}-$${value.high.toFixed(2)}`;
}

function renderItem(item: ItineraryItem): string[] {
  const time = `${item.start}-${item.end}`;
  if (item.kind === 'transit' && item.transit) {
    const leg = item.transit;
    const lines = [
      `- ${time} **Transit:** ${escapeMarkdown(leg.fromLabel)} to ${escapeMarkdown(leg.toLabel)} (${leg.durationMinutes} min, fare $${leg.fareUSD.toFixed(2)})`,
    ];
    for (const step of leg.steps)
      lines.push(`  - ${step.kind} (${step.minutes} min): ${escapeMarkdown(step.instruction)}`);
    return lines;
  }
  const lines = [`- ${time} **${escapeMarkdown(item.title)}**${item.isWishlist ? ' (wishlist)' : ''}`];
  if (item.description) lines.push(`  - ${escapeMarkdown(item.description)}`);
  if (item.placeId) lines.push(`  - Estimated cost per person: ${money(item.cost)}`);
  if (item.safety) lines.push(`  - Safety (${item.safety.level}): ${escapeMarkdown(item.safety.note)}`);
  if (item.bookingTip) lines.push(`  - ${escapeMarkdown(item.bookingTip)}`);
  return lines;
}

function renderDay(day: DayPlan, index: number): string[] {
  return [
    `## Day ${index + 1}: ${day.date} (${day.weekday}) - ${escapeMarkdown(day.theme)}`,
    '',
    '**Safety guidance**',
    '',
    ...day.safetyGuidance.map((line) => `- ${escapeMarkdown(line)}`),
    '',
    '**Timeline**',
    '',
    ...day.items.flatMap(renderItem),
    '',
    `Walking: ${day.walkingMinutes} min. Estimated cost per person: ${money(day.cost)}. ${escapeMarkdown(day.paceNote)}`,
    '',
  ];
}

function renderStatus(plan: PlanRecord): string[] {
  if (plan.status === 'FAILED') {
    return [`**Status:** FAILED`, '', escapeMarkdown(plan.error ?? 'The plan could not be built.'), ''];
  }
  const progress = plan.progress
    .filter((step) => step.status !== 'pending')
    .map((step) => `- ${step.agent}: ${step.status}${step.summary ? ` - ${escapeMarkdown(step.summary)}` : ''}`);
  return [
    `**Status:** ${plan.status}`,
    '',
    'Your plan is still being built. Fetch it again in a minute.',
    ...(progress.length > 0 ? ['', ...progress] : []),
    '',
  ];
}

/** The plan as Markdown. */
export function renderPlanMarkdown(plan: PlanRecord): string {
  const lines = [`# ${escapeMarkdown(plan.title)}`, ''];
  const itinerary = plan.itinerary;
  if (plan.status !== 'SUCCEEDED' || !itinerary) return [...lines, ...renderStatus(plan)].join('\n');
  lines.push(escapeMarkdown(itinerary.summary), '', `> ${escapeMarkdown(itinerary.disclaimer)}`, '');
  itinerary.days.forEach((day, index) => lines.push(...renderDay(day, index)));
  lines.push('## Not scheduled', '');
  if (itinerary.unscheduled.length === 0) lines.push('Every wishlist place is in the timeline.');
  for (const entry of itinerary.unscheduled)
    lines.push(`- ${escapeMarkdown(entry.name)}: ${escapeMarkdown(entry.reason)}`);
  lines.push('', '## Safety', '', ...itinerary.safetyBrief.map((line) => `- ${escapeMarkdown(line)}`), '');
  lines.push('## Getting around', '', ...itinerary.transitBrief.map((line) => `- ${escapeMarkdown(line)}`), '');
  lines.push(
    '## Estimated costs per person',
    '',
    `- Food: ${money(itinerary.costs.food)}`,
    `- Attractions: ${money(itinerary.costs.attractions)}`,
    `- Transit: ${money(itinerary.costs.transit)}`,
    `- Total: ${money(itinerary.costs.total)}`,
    `- ${escapeMarkdown(itinerary.costs.transitPassAdvice)}`,
    '',
  );
  lines.push('## About this plan', '', `- Boston data version: ${escapeMarkdown(plan.dataVersion)}`);
  for (const credit of plan.sourceCredits) lines.push(`- Credit: ${escapeMarkdown(credit)}`);
  lines.push(`- Generated at ${itinerary.generatedAt}`, '');
  return lines.join('\n');
}
