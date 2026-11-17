# Personas

Two personas, as chosen in user-stories Q1. Both come from the approved requirements (`inception/requirements-analysis/requirements.md`, FR1) and the Ideation stakeholder map: you are the only decision-maker and the first traveler.

## P1. Invited Traveler

| Field | Detail |
|-------|--------|
| Role | A person the admin has invited by email. In this version that is fewer than 10 people: the requester and the people they travel with (approval-handoff Q2). |
| Goals | Get a day-by-day Boston plan they can trust to keep them safe hour by hour. Get around by public transport without missing the last train. Read the plan comfortably without a web app. |
| Pain points | Itinerary apps plan trips but ignore safety by time of day (market research). Planning a safe, relaxed trip by hand takes hours. |
| Context | Calls the API directly (curl, Postman or a script) and reads the plan as Markdown or JSON (requirements Q4). Has a limit of 3 plans a month. |
| Tech comfort | Medium to high; comfortable reading Markdown and making an API call. |
| Frequency | A few times per trip, at most 3 plans a month. |

## P2. Admin

| Field | Detail |
|-------|--------|
| Role | The requester: the only builder and the only admin (C-10, requirements Q1). |
| Goals | Control exactly who can use the API. Keep total running cost under $25 a month. Keep the Boston data correct. Delete people's data when they ask. |
| Pain points | No second person to catch mistakes. Building time is limited to about 45 hours. A wrong safety call could harm a traveler. |
| Context | Invites, disables and deletes accounts through a documented admin action (requirements A-5). Changes Boston data through versioned files and a deploy (requirements Q8). |
| Tech comfort | High: TypeScript and AWS. |
| Frequency | Weekly while building; on request after launch. |

## Relationships and Priority

1. **P1 Invited Traveler** comes first: every Must story for the plan is theirs.
2. **P2 Admin** comes second: access, data and cost stories that make P1's experience safe and affordable.

The requester is both P2 and the first P1 (their own Nov 18 trip).
