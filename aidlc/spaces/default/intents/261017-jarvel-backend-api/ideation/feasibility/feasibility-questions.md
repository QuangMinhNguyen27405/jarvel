# Feasibility & Constraints — Questions

Context: the approved intent statement (`ideation/intent-capture/intent-statement.md`) sets a public, free, any-city planner, ready by Nov 18, 2026, with an itinerary in under 5 minutes, running under $25 per month and up to 3 plans per person per month. The build-vs-buy decision (`ideation/market-research/build-vs-buy.md`) is to build the planning and use outside sources for place, transit and safety information. The repository already has a TypeScript workspace setup and a backend package that lists AWS libraries. These questions test whether that fits the time, money and people available.

## Q1. What must this work fit with? (select all that apply)

A. The existing Jarvel repository setup (shared types, workspace layout) that is already in place
B. An AWS account you already use
C. Outside data sources that are still to be chosen (places, transit, safety)
D. None
X. Other (please specify)

[Answer]: A, B, C

## Q2. Where may public users' personal data be stored?

Market research flagged privacy laws (Q7 there) because sign-up is open to anyone online.

A. United States only
B. Users' own region where required (for example EU data in the EU)
C. No requirement
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q3. Who will build this, and how familiar are they with TypeScript and AWS?

A. Just me (with AI help), comfortable with TypeScript and AWS
B. Just me (with AI help), comfortable with TypeScript but new to AWS
C. A small team (say who)
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q4. How much time per week can go into building it before Nov 18, 2026?

A. Under 10 hours per week
B. 10 to 20 hours per week
C. 20 to 40 hours per week
D. Full time (more than 40 hours per week)
E. Not yet defined
X. Other (please specify)

[Answer]: A

## Q5. What cloud access is ready today?

A. An AWS account with access to AI models already enabled
B. An AWS account, but AI model access not yet requested
C. No AWS account yet
D. I would rather use another cloud (say which)
X. Other (please specify)

[Answer]: A

## Q6. Does the $25 monthly cap also apply while building and testing?

A. Yes, the same $25 per month cap applies during building
B. No, I can spend more while building (say how much)
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q7. May the outside data sources cost money?

Build vs buy decided to take place, transit and safety information from outside sources.

A. Free sources only
B. Paid sources are fine if the total still fits under $25 per month
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Q8. Is anything likely to block or slow the work?

A. Nothing I know of
B. Other commitments (work, study, trip preparation) limit my time
C. Not yet defined
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Must fit with: the existing Jarvel repository setup, your existing AWS account, and outside data sources still to be chosen [Q1]
- Users' personal data stored in the United States only [Q2]
- Builder: you alone, with AI help, comfortable with TypeScript and AWS [Q3]
- Time: under 10 hours per week until Nov 18, 2026 (roughly 4.5 weeks, so under about 45 hours in total) [Q4]
- Cloud: AWS account with AI model access already enabled [Q5]
- Money: the $25 per month cap also covers building and testing [Q6]; outside data sources must be free [Q7]
- Blockers: none known [Q8]

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
