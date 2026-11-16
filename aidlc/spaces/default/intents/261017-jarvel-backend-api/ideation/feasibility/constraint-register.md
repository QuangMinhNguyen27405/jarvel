# Constraint Register: Jarvel

Constraints come from the approved intent statement (`ideation/intent-capture/intent-statement.md`), the market research (`ideation/market-research/competitive-analysis.md`, `market-trends.md`, `build-vs-buy.md`) and the answers in `feasibility-questions.md`.

## Constraints

| ID | Type | Constraint | Source | Impact |
|----|------|------------|--------|--------|
| C-01 | Time | First version works by Nov 18, 2026; if not everything fits, the date holds and scope is cut | Intent statement | Forces a smaller first version (see feasibility assessment) |
| C-02 | Time | Under 10 hours per week of building time until Nov 18, 2026 (under about 45 hours) | Q4 | Hard limit on how much can be built |
| C-03 | Financial | Total running cost under $25 per month, including building and testing | Intent statement; Q6 | Limits AI usage per plan and plans per month |
| C-04 | Financial | Outside data sources must be free | Q7 | Rules out paid place, transit and safety data |
| C-05 | Financial | Up to 3 plans per person per month | Intent statement | Caps usage per person, but not in total |
| C-06 | Technical | Must fit the existing Jarvel repository setup | Q1 | New work follows the existing workspace layout and shared types |
| C-07 | Technical | Must run in the builder's existing AWS account, where AI model access is enabled | Q1; Q5 | Cloud provider is fixed |
| C-08 | Technical | Build the planning ourselves; take place, transit and safety information from outside sources | Build vs buy | Depends on free outside sources (C-04) |
| C-09 | Technical | An itinerary comes back in under 5 minutes | Intent statement | Limits how many AI steps a plan can take |
| C-10 | Organizational | One builder (with AI help), comfortable with TypeScript and AWS | Q3 | No parallel work; no one else to review |
| C-11 | Regulatory | Public users' personal data stored in the United States only | Q2 | Storage location fixed |
| C-12 | Regulatory | Privacy laws apply to public users' data (for example GDPR, CCPA) | Market trends | Sign-up must handle consent, access and deletion |
| C-13 | Regulatory | Responsibility for safety advice; disclaimers needed | Market trends | Wording of safety guidance and warnings matters |
| C-14 | Regulatory | Terms of use of outside data (attribution, usage limits) | Market trends; build vs buy | Each chosen source's terms must be followed |
| C-15 | Product | Where a city has no hand-checked safety knowledge, still plan but warn that safety was not checked | Intent statement | The safety promise only holds where data exists |
| C-16 | Product | First version leaves out the web app and revising an existing plan | Intent statement | Backend API only |

## Assumptions & Open Questions

None.
