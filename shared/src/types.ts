// Shared contracts for Jarvel — the Boston trip-planning multi-agent app.
// Imported by backend (Lambda), infra (CDK) and frontend (React) as "@jarvel/shared".
// Times are local Boston time (America/New_York). Dates are "YYYY-MM-DD", times "HH:MM" (24h).

// ---------------------------------------------------------------------------
// Static knowledge base (backend/src/data/*.json) — curated + verified by research
// ---------------------------------------------------------------------------

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type PlaceCategory =
  | 'bakery'
  | 'coffee'
  | 'restaurant'
  | 'fine-dining'
  | 'attraction'
  | 'museum'
  | 'park'
  | 'campus'
  | 'neighborhood'
  | 'shopping'
  | 'viewpoint';

export interface Money {
  low: number; // USD per person
  high: number;
}

export interface Place {
  id: string; // kebab-case, stable, e.g. "tatte-back-bay"
  name: string;
  aliases?: string[]; // other spellings a traveler may type for this place, e.g. a common misspelling
  category: PlaceCategory;
  cuisine?: string; // e.g. "Vietnamese", "Taiwanese", "Burgers"
  neighborhood: string; // e.g. "Back Bay", "Chinatown", "Cambridge - Harvard Square"
  safetyAreaId: string; // -> SafetyArea.id
  address: string;
  lat: number;
  lng: number;
  nearestStationId: string; // -> Station.id
  walkMinutesFromStation: number;
  // Opening hours per weekday; [] = closed that day. Each range is ["HH:MM","HH:MM"].
  // Use "24:00"/"26:00" style closing for past-midnight. Omit key if unknown.
  hours: Partial<Record<DayKey, [string, string][]>>;
  hoursNote?: string; // free-text caveat, e.g. "kitchen closes 30 min earlier"
  typicalDwellMinutes: number;
  priceLevel: 1 | 2 | 3 | 4;
  estCostPerPerson: Money; // incl. typical tax+tip for food; ticket price for attractions
  reservation: 'none' | 'recommended' | 'required';
  bookingUrl?: string;
  userRequested: boolean; // true if from the traveler's original wishlist
  matchedFrom?: string; // the traveler's original (possibly misspelled) wording
  tags: string[]; // e.g. ["indoor", "rainy-day", "free", "michelin-star", "must-see"]
  description: string; // 1-2 sentences
  tips?: string; // what to order / what to do
  sourceUrls: string[];
  verified: boolean; // research confirmed it exists & is open as of 2026
  confidenceNote?: string; // what could not be verified
}

export type LineId =
  | 'blue'
  | 'orange'
  | 'red'
  | 'red-ashmont'
  | 'red-braintree'
  | 'green-b'
  | 'green-c'
  | 'green-d'
  | 'green-e'
  | 'green-trunk'
  | 'silver-sl1'
  | 'silver-sl3'
  | 'walk-transfer'
  | 'shuttle';

export interface Line {
  id: LineId;
  name: string; // "Blue Line"
  color: string; // hex
  mode: 'subway' | 'light-rail' | 'bus-rapid-transit' | 'walk' | 'shuttle';
  headwayMinutes: { peak: number; offPeak: number; evening: number };
  firstTrain: string; // approx "05:15"
  lastTrain: string; // approx "00:30"
  // Optional per-weekday service hours that override firstTrain/lastTrain (e.g. later Sunday start).
  serviceByDay?: Partial<Record<DayKey, { firstTrain: string; lastTrain: string }>>;
  fareUSD: number; // single ride, CharlieCard/contactless
}

// How a traveler gets from the BOS terminals onto the stored network (e.g. a free shuttle to a station).
export interface AirportAccess {
  label: string; // "Boston Logan Airport (BOS)"
  stationId: string; // -> Station.id
  accessMinutes: number;
  lat: number;
  lng: number;
  instruction: string; // "Free shuttle from your terminal to Airport station"
}

export interface Station {
  id: string; // e.g. "wonderland", "state", "park-street"
  name: string;
  lines: LineId[];
  lat: number;
  lng: number;
  accessible: boolean;
}

export interface Edge {
  from: string; // Station.id
  to: string; // Station.id (edges are bidirectional)
  line: LineId;
  minutes: number; // in-vehicle time between adjacent stations
}

export interface TransitNetwork {
  lines: Line[];
  stations: Station[];
  edges: Edge[];
  transferPenaltyMinutes: number; // avg wait+walk when changing lines
  airport?: AirportAccess;
  fares: {
    subwaySingle: number;
    busSingle: number;
    sl1FromAirportFree: boolean;
    dayPass: number; // 1-day LinkPass
    weekPass: number; // 7-day LinkPass
    notes: string;
  };
  sourceUrls: string[];
}

export type RiskLevel = 'low' | 'moderate' | 'elevated';

export interface SafetyArea {
  id: string; // e.g. "back-bay", "downtown-crossing", "chinatown", "revere-beach"
  name: string;
  center: { lat: number; lng: number };
  radiusKm: number;
  bpdDistricts: string[]; // Boston Police district codes e.g. ["A1"], [] outside Boston
  dayRisk: RiskLevel;
  nightRisk: RiskLevel;
  avoidAfter?: string; // "HH:MM" — scheduler must not place visits here after this
  notes: string; // concrete, non-alarmist guidance
}

export interface SafetyKnowledge {
  areas: SafetyArea[];
  generalTips: string[];
  crimeApi: {
    // Analyze Boston CKAN datastore (Crime Incident Reports)
    endpoint: string; // e.g. "https://data.boston.gov/api/3/action/datastore_search_sql"
    resourceId: string;
    districtField: string;
    dateField: string;
    notes: string;
  };
  sourceUrls: string[];
}

export interface TripDefaults {
  hotel: HotelInfo;
  arrival: string; // "2026-11-18T10:00"
  departure: string; // "2026-11-21T15:00"
  airportCode: 'BOS';
  wishlist: WishlistEntry[]; // the traveler's original list, pre-resolved
  novemberClimate: { avgHighF: number; avgLowF: number; sunrise: string; sunset: string; precipDaysPct: number };
  holidaysAndEvents: string[]; // notable things Nov 18-21 2026
}

export interface WishlistEntry {
  original: string; // traveler's wording, e.g. "tate bakery"
  placeIds: string[]; // resolved Place ids (may be several candidates/branches)
  kind: 'specific' | 'category'; // "Chinatown"/"Vietnamese restaurants" are category
  note?: string;
}

export interface HotelInfo {
  name: string;
  address: string;
  lat: number;
  lng: number;
  nearestStationId: string;
  walkMinutesToStation: number;
  shuttleNote?: string; // airport/T shuttle availability
}

// ---------------------------------------------------------------------------
// API: trip request + plan records
// ---------------------------------------------------------------------------

export type Pace = 'relaxed' | 'moderate' | 'packed';
export type SafetyStrictness = 'standard' | 'strict';
export type BudgetLevel = 'budget' | 'moderate' | 'splurge';

export interface TripPreferences {
  pace: Pace; // relaxed = max ~3 major stops/day, >=30 min buffers
  safety: SafetyStrictness; // strict = also avoid 'moderate' nightRisk areas after dark
  budgetLevel: BudgetLevel;
  transport: 'subway-first' | 'mixed';
  maxWalkMinutes: number; // single walking leg cap, default 15
  dayStart: string; // "09:00"
  dayEnd: string; // "21:30" — be back at hotel by
  dietary?: string;
  includeMichelin: boolean;
}

export interface TripRequest {
  title?: string;
  arrival: string; // "2026-11-18T10:00"
  departure: string; // "2026-11-21T15:00"
  travelers: number;
  hotel: HotelInfo;
  wishlist: string[]; // raw strings and/or Place ids
  notes?: string; // free text to the agents
  preferences: TripPreferences;
}

export interface ReviseRequest {
  feedback: string; // "It will rain Thursday, swap outdoor stuff"; "I'm in Chinatown now, running 1h late"
  fromDate?: string; // replan only from this date onward
  fromTime?: string; // and from this time
  currentLocation?: string; // free text or Place/Station id
}

export type AgentName =
  | 'researcher' // resolves wishlist, picks places, verifies hours
  | 'safety' // crime stats + area risk by time of day
  | 'transit' // subway strategy, passes, airport/hotel logistics
  | 'scheduler' // drafts day-by-day itinerary at the requested pace
  | 'critic' // validates (hours, rush, safety, walking) and requests fixes
  | 'budget'; // cost estimate

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface AgentProgress {
  agent: AgentName;
  status: AgentStatus;
  iteration?: number;
  startedAt?: string; // ISO
  finishedAt?: string;
  summary?: string; // one-line human-readable result
}

export type PlanStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

// Why a plan ended FAILED. Every kind gives the monthly count back (D6).
export type PlanFailureKind = 'timeout' | 'ai-error' | 'internal' | 'no-safe-plan';

export interface PlanRecord {
  userId: string; // Cognito sub
  planId: string; // UUID
  version: number; // always 1 in this version (revise is not built)
  status: PlanStatus;
  title: string;
  request: TripRequest; // stored as sent, with documented defaults filled in
  revisions: (ReviseRequest & { at: string; version: number })[]; // unused in this version (A-6)
  progress: AgentProgress[];
  itinerary?: Itinerary;
  error?: string; // plain-language reason when FAILED; never internal details
  failureKind?: PlanFailureKind;
  executionArn?: string; // unused in this version
  dataVersion: string; // version of the Boston data the plan was (or will be) built from
  sourceCredits: string[]; // outside sources that must be credited
  aiCostUSD: number; // AI cost spent on this plan so far (0 until the AI is called)
  durationMs: number | null; // build time from acceptance to the final status; null until final
  acceptedAt: string; // ISO instant the request was accepted (the 5-minute clock starts here)
  createdAt: string;
  updatedAt: string;
}

export type PlanSummary = Pick<PlanRecord, 'planId' | 'title' | 'status' | 'version' | 'createdAt' | 'updatedAt'> & {
  arrival: string;
  departure: string;
};

export interface ListPlansResponse {
  plans: PlanSummary[];
}

export interface RenamePlanRequest {
  title: string;
}

// ---------------------------------------------------------------------------
// Itinerary (final output of the multi-agent pipeline)
// ---------------------------------------------------------------------------

export interface TransitStep {
  kind: 'walk' | 'ride' | 'transfer' | 'wait';
  line?: LineId;
  fromStationId?: string;
  toStationId?: string;
  direction?: string; // "toward Bowdoin"
  stops?: number;
  minutes: number;
  instruction: string; // "Walk 8 min to Wonderland station"
}

export interface TransitLeg {
  mode: 'subway' | 'walk' | 'bus' | 'shuttle' | 'rideshare';
  fromLabel: string;
  toLabel: string;
  steps: TransitStep[];
  durationMinutes: number;
  fareUSD: number;
  rideshareReason?: string; // why subway was not used (late night, safety)
}

export interface ItineraryItem {
  id: string;
  kind: 'visit' | 'meal' | 'transit' | 'rest' | 'hotel' | 'airport';
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  title: string;
  placeId?: string;
  description: string;
  transit?: TransitLeg; // present when kind === 'transit'
  cost: Money; // per person
  safety?: { level: RiskLevel; note: string };
  bookingTip?: string;
  isWishlist?: boolean;
  location?: { lat: number; lng: number }; // where a visit, meal or hotel item happens, for the trip map
}

export interface WeatherSummary {
  source: 'nws-forecast' | 'climatology';
  summary: string; // "Partly cloudy, 48°F / 36°F"
  highF?: number;
  lowF?: number;
  precipChancePct?: number;
}

export interface DayPlan {
  date: string; // "2026-11-18"
  weekday: DayKey;
  theme: string; // "Arrival + Back Bay & Chinatown"
  weather?: WeatherSummary;
  items: ItineraryItem[];
  cost: Money;
  walkingMinutes: number;
  paceNote: string; // why this day is not rushed
  safetyGuidance: string[]; // the safety guidance for this day (FR4.4)
}

export interface CostBreakdown {
  food: Money;
  attractions: Money;
  transit: Money;
  other: Money;
  total: Money;
  transitPassAdvice: string; // e.g. "Buy a 7-day LinkPass ($22.50) — you take ~14 rides"
  notes: string[];
}

export interface CriticIssue {
  severity: 'blocker' | 'warning' | 'info';
  category: 'hours' | 'safety' | 'pace' | 'walking' | 'transit' | 'wishlist' | 'timing' | 'budget';
  date?: string;
  itemId?: string;
  message: string;
}

export interface Itinerary {
  summary: string;
  days: DayPlan[];
  costs: CostBreakdown;
  safetyBrief: string[]; // top safety guidance for this trip
  transitBrief: string[]; // CharlieCard, Blue Line from hotel, last trains, airport
  unscheduled: { placeId?: string; name: string; reason: string }[];
  criticIssues: CriticIssue[]; // remaining (non-blocker) issues after critique
  disclaimer: string; // safety information is guidance, not a guarantee (FR4.4)
  generatedAt: string;
  modelId: string;
}

// ---------------------------------------------------------------------------
// HTTP API (API Gateway HTTP API, JWT authorizer = Cognito access token)
// ---------------------------------------------------------------------------
// Routes in this version (D9):
//   GET    /health                 -> { status: 'ok' }  (no auth, no data)
//   POST   /plans        TripRequest  -> 202 CreatePlanResponse  (optional Idempotency-Key header)
//   GET    /plans/{planId}         -> PlanRecord (JSON), or Markdown with ?format=markdown / Accept: text/markdown
//   GET    /plans                  -> 200 ListPlansResponse (newest first)
//   PATCH  /plans/{planId}  RenamePlanRequest -> 200 PlanRecord (only the title can be edited)
//   DELETE /plans/{planId}         -> 204
// Errors: ApiErrorBody with 4xx/5xx; 429 uses QuotaExceededBody.
// Not built in this version: GET /catalog, POST /plans/{planId}/revise.

export interface ApiFieldError {
  field: string; // dotted path, e.g. "preferences.dayStart"
  message: string;
}

export interface ApiErrorBody {
  error: string; // plain-language message
  code: string; // kebab-case machine code, e.g. "invalid-request"
  fields?: ApiFieldError[];
}

export interface QuotaExceededBody extends ApiErrorBody {
  limit: number;
  used: number;
  resetsOn: string; // "YYYY-MM-DD", the 1st of next month, Boston time
}

export interface CatalogResponse {
  places: Place[];
  defaults: TripDefaults;
  stations: Station[];
  lines: Line[];
  safetyAreas: SafetyArea[];
}

export interface CreatePlanResponse {
  planId: string;
  version: number;
  status: PlanStatus;
}

export interface FrontendConfig {
  region: string;
  apiUrl: string; // no trailing slash
  userPoolId: string;
  userPoolClientId: string;
  mock?: boolean; // local dev: skip auth + use in-browser mock API with fixture data
  /**
   * Amazon Location API key for the map. It is a browser key: the stack limits it to reading map tiles. With it and
   * `region` the map is Amazon Location's; without it the map is OpenStreetMap.
   */
  mapsApiKey?: string;
  /** Amazon Location map style. Default: Standard. */
  mapStyle?: 'Standard' | 'Monochrome' | 'Hybrid' | 'Satellite';
}

// ---------------------------------------------------------------------------
// Step Functions state (small; agent artifacts live in S3 at deterministic keys
// plans/{planId}/v{version}/{agent}[-{iteration}].json)
// ---------------------------------------------------------------------------

export interface StepState {
  userId: string;
  planId: string;
  version: number;
  iteration: number; // scheduler/critic loop counter, starts at 0
  needsRevision?: boolean; // set by critic: blockers > 0 && iteration < 2 (critic also bumps iteration)
  error?: { Error?: string; Cause?: string }; // set by Catch before MarkFailed
}
