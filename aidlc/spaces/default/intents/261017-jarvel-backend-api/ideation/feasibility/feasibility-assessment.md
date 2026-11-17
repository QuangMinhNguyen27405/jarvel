# Feasibility Assessment: Jarvel

Inputs: the approved intent statement (`ideation/intent-capture/intent-statement.md`), competitive analysis (`ideation/market-research/competitive-analysis.md`), market trends (`ideation/market-research/market-trends.md`), build vs buy (`ideation/market-research/build-vs-buy.md`), and the answers in `feasibility-questions.md`.

## Verdict

**Not feasible as stated by Nov 18, 2026. Feasible if the first version is cut down.**

The approved first version is a free, public planner for any city, with hourly safety checks, an itinerary in under 5 minutes, and under $25 per month (intent statement). With under about 45 hours of building time (Q4), a $25 monthly cap that also covers building and testing (Q6), and free data sources only (Q7), all of it will not fit. The approved rule for this case is to keep the date and cut the scope (intent statement, trade-off rule). Scope Definition decides what to cut. The options are listed at the end of this document.

Estimates below are deliberately conservative and labelled as estimates.

## Assessment by Area

| Area | Rating | Why |
|------|--------|-----|
| People and skills | Feasible | One builder with AI help, comfortable with TypeScript and AWS (Q3); an existing repository setup to build on (Q1) |
| Cloud access | Feasible | AWS account with AI model access already enabled (Q5) |
| Time to Nov 18, 2026 | **Not feasible at full scope** | Under 10 hours per week for about 4.5 weeks, so under about 45 hours in total (Q4), for sign-up, plan limits, any-city planning, safety warnings, and tests at the 80% coverage floor this kind of work requires (team testing rules) |
| Running cost under $25 per month | **At risk** | See the cost estimate below; the AI cost per plan alone can exceed the cap at the approved usage |
| City information for any city, free only | **At risk** | Free sources cover places and transit unevenly, and safety data exists only for some cities (see below) |
| Safety promise | **Partly feasible** | "No safety rule broken" can only be tested where safety information exists; elsewhere the planner can only warn (intent statement) |
| Privacy and data rules | Feasible with care | Storing public users' data in the US only (Q2); privacy law, safety-advice disclaimers and data terms still apply (market trends) |

## Cost Estimate (hypothesis)

The approved usage allows up to 3 plans per person per month for fewer than 100 people, so up to about 300 plans per month (intent statement).

| Item | Estimate | Basis |
|------|----------|-------|
| AI cost per plan, larger model | About $0.30 | Assumed 60,000 words-in units (tokens) read and 8,000 written per plan, at $3 / $15 per million ([Bedrock pricing, third-party summary](https://deploybase.ai/articles/amazon-bedrock-pricing); [AWS pricing page](https://aws.amazon.com/bedrock/pricing/)) |
| AI cost per plan, smaller model | About $0.10 | Same assumed usage at $1 / $5 per million ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)) |
| AI budget left after hosting and testing | About $15 per month (assumption) | $25 cap minus an assumed $10 for hosting, storage and test runs (Q6) |
| Plans that fit the AI budget | About 50 (larger model) to 150 (smaller model) per month | $15 divided by the per-plan estimates |

At 300 plans per month the AI cost alone would be about $30 to $90, which is over the cap. Staying under $25 needs one or more of: a total monthly plan limit across all users, fewer AI steps per plan, a smaller AI model, or fewer plans per person. The token usage per plan is a guess until a real plan is measured; it could be lower or much higher.

## City Information (free sources only)

| Need | What free sources offer | Effect |
|------|------------------------|--------|
| Places and opening hours | OpenStreetMap holds about a million opening-hours entries, but no published figure says what share of places have them ([OSM contributor diary](https://api.openstreetmap.org/user/ypid/diary/34881)) | "Opening hours checked" (a table stake per market research) will be patchy in many cities |
| Transit routes and timetables | Open timetable feeds exist for roughly 2,500 to 3,000 operators in 50+ countries ([Interline](https://www.interline.io/blog/us-ntd-reporting-gtfs/)); in the US only 41% of reporting agencies publish one ([Transitland](https://www.transit.land/id-crosswalks/us-ntd)) | Transit-first plans and last-train awareness work only where a feed exists |
| Safety by area and time of day | Open crime data exists for some US and UK cities (market trends) | Most cities will get the "safety not checked" warning (intent statement) |

## Scope Options for Scope Definition

These are options, not decisions; Scope Definition chooses.

| Option | What changes | Fits Nov 18? | Trade-off |
|--------|--------------|-------------|-----------|
| A. Few cities first | Plan for Boston (or a short list) with checked data; other cities later | Most likely | Drops "any city" from the first version |
| B. Any city, lighter checks | Any city, but safety and opening-hours checks only where data exists, with clear warnings | Possible | Weaker version of the main difference from competitors |
| C. Private first | Same planner, but invite-only at launch; public sign-up later | Helps cost and time | Drops "public" from the first version |
| D. Combination | For example A plus C: Boston, invite-only, then widen | Most likely | Smallest first version |

## Assumptions & Open Questions

- Assumption: about 60,000 tokens read and 8,000 written per plan. Not measured; a single real plan run would replace this guess.
- Assumption: hosting, storage and test runs cost about $10 per month. Not measured.
- Assumption: AI pricing as listed in October 2026 third-party summaries; the official AWS page should be checked before budgeting.
- Open: which scope option to take is for Scope Definition.
