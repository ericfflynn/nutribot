// Google Health API client. Ported from nutribot-core/nutribot/health/google.py.
// Errors carry status codes only: never response bodies, tokens, or request URLs.

const API_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Record types: one data point per day or per session, fetched with `list` and
// filtered to Fitbit records. The value is the API filter field.
// Excluded on purpose: minute-level `heart-rate`; `floors` and
// `basal-energy-burned`, which come back without a data source; and the
// nutrition and hydration logs, which need a scope the app doesn't request.
const RECORD_TYPES = {
  "daily-resting-heart-rate": "daily_resting_heart_rate.date",
  "daily-heart-rate-variability": "daily_heart_rate_variability.date",
  "daily-sleep-temperature-derivations": "daily_sleep_temperature_derivations.date",
  "daily-oxygen-saturation": "daily_oxygen_saturation.date",
  "daily-vo2-max": "daily_vo2_max.date",
  "daily-heart-rate-zones": "daily_heart_rate_zones.date",
  "daily-respiratory-rate": "daily_respiratory_rate.date",
  exercise: "exercise.interval.civil_start_time",
  weight: "weight.sample_time.civil_time",
  "body-fat": "body_fat.sample_time.civil_time",
  sleep: "sleep.interval.civil_end_time"
} as const;

// Daily totals: activity is recorded per minute, so these use `dailyRollUp`
// restricted to Fitbit/Google trackers instead. The value is the API data type.
const DAILY_TOTAL_TYPES = {
  "daily-steps": "steps",
  "daily-distance": "distance",
  "daily-active-energy": "active-energy-burned",
  "daily-total-calories": "total-calories",
  "daily-active-minutes": "active-minutes",
  "daily-active-zone-minutes": "active-zone-minutes"
} as const;

type RecordType = keyof typeof RECORD_TYPES;
type DailyTotalType = keyof typeof DAILY_TOTAL_TYPES;
export type HealthDataType = RecordType | DailyTotalType;

export const HEALTH_DATA_TYPES = [
  ...Object.keys(RECORD_TYPES),
  ...Object.keys(DAILY_TOTAL_TYPES)
] as HealthDataType[];

const SMALL_PAGE_TYPES = new Set<HealthDataType>(["sleep", "exercise"]);
const ROLLUP_SOURCE_FAMILY = "users/me/dataSourceFamilies/google-wearables";
// dailyRollUp caps some types at 14 days per request; use it for all of them.
const ROLLUP_MAX_DAYS = 14;

export function isHealthDataType(value: string): value is HealthDataType {
  return value in RECORD_TYPES || value in DAILY_TOTAL_TYPES;
}

function isDailyTotalType(kind: HealthDataType): kind is DailyTotalType {
  return kind in DAILY_TOTAL_TYPES;
}

// Google Health also returns Apple Health (HEALTH_KIT) and untagged records.
function isFitbitRecord(point: Record<string, unknown>) {
  const source = point.dataSource as { platform?: unknown } | undefined;
  return source?.platform === "FITBIT";
}

function civilDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day } };
}

function addDaysUtc(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// A rollup window with no measurements carries only its time bounds.
function hasRollupValue(point: Record<string, unknown>) {
  return Object.keys(point).some((key) => key !== "civilStartTime" && key !== "civilEndTime");
}

export class GoogleHealthError extends Error {}

const TRANSIENT = /^(HTTP (429|500|502|503|504)|Network failure)/;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new GoogleHealthError(`Network failure (${error instanceof Error ? error.name : "unknown"})`);
  }
  if (!response.ok) {
    let reason = "";
    try {
      const body = (await response.json()) as { error?: string | { status?: string } };
      reason = typeof body.error === "string" ? body.error : body.error?.status || "";
    } catch {
      // Ignore unreadable error bodies.
    }
    throw new GoogleHealthError(`HTTP ${response.status} ${reason}`.trim());
  }
  return response.json();
}

async function request(url: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(url, init);
    } catch (error) {
      if (!(error instanceof GoogleHealthError) || !TRANSIENT.test(error.message) || attempt === 3) {
        throw error;
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new GoogleHealthError(`Missing ${name}`);
  }
  return value;
}

export class GoogleHealthClient {
  private accessToken: string | null = null;

  async refreshAccessToken() {
    const payload = (await request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
        grant_type: "refresh_token"
      })
    })) as { access_token?: unknown };
    if (typeof payload.access_token !== "string") {
      throw new GoogleHealthError("Token refresh returned no access token");
    }
    this.accessToken = payload.access_token;
    return this.accessToken;
  }

  private async call(url: string, body?: unknown) {
    const send = (token: string) =>
      request(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    const token = this.accessToken ?? (await this.refreshAccessToken());
    try {
      return await send(token);
    } catch (error) {
      if (!(error instanceof GoogleHealthError) || !error.message.startsWith("HTTP 401")) {
        throw error;
      }
      return send(await this.refreshAccessToken());
    }
  }

  // Yields pages of Fitbit data points for [start, end), dates as YYYY-MM-DD.
  // Daily total types yield one point per day that has a value.
  async *pages(kind: HealthDataType, start: string, end: string): AsyncGenerator<Record<string, unknown>[]> {
    if (isDailyTotalType(kind)) {
      yield* this.dailyTotals(kind, start, end);
    } else {
      yield* this.records(kind, start, end);
    }
  }

  private async *records(kind: RecordType, start: string, end: string) {
    const field = RECORD_TYPES[kind];
    const params = new URLSearchParams({
      pageSize: SMALL_PAGE_TYPES.has(kind) ? "25" : "10000",
      filter: `${field} >= "${start}" AND ${field} < "${end}"`
    });
    const seen = new Set<string>();

    while (true) {
      const payload = (await this.call(`${API_BASE}/${kind}/dataPoints?${params}`)) as {
        dataPoints?: unknown;
        nextPageToken?: unknown;
      };
      const points = payload.dataPoints ?? [];
      if (!Array.isArray(points)) {
        throw new GoogleHealthError("Invalid pagination response");
      }
      yield (points as Record<string, unknown>[]).filter(isFitbitRecord);

      const next = nextToken(payload.nextPageToken, seen);
      if (!next) {
        return;
      }
      params.set("pageToken", next);
    }
  }

  private async *dailyTotals(kind: DailyTotalType, start: string, end: string) {
    for (let windowStart = start; windowStart < end; ) {
      const capped = addDaysUtc(windowStart, ROLLUP_MAX_DAYS);
      const windowEnd = capped < end ? capped : end;
      const body: Record<string, unknown> = {
        range: { start: civilDate(windowStart), end: civilDate(windowEnd) },
        windowSizeDays: 1,
        dataSourceFamily: ROLLUP_SOURCE_FAMILY
      };
      const seen = new Set<string>();

      while (true) {
        const payload = (await this.call(
          `${API_BASE}/${DAILY_TOTAL_TYPES[kind]}/dataPoints:dailyRollUp`,
          body
        )) as { rollupDataPoints?: unknown; nextPageToken?: unknown };
        const points = payload.rollupDataPoints ?? [];
        if (!Array.isArray(points)) {
          throw new GoogleHealthError("Invalid rollup response");
        }
        yield (points as Record<string, unknown>[]).filter(hasRollupValue);

        const next = nextToken(payload.nextPageToken, seen);
        if (!next) {
          break;
        }
        body.pageToken = next;
      }
      windowStart = windowEnd;
    }
  }
}

function nextToken(value: unknown, seen: Set<string>) {
  if (!value) {
    return null;
  }
  if (typeof value !== "string" || seen.has(value)) {
    throw new GoogleHealthError("Invalid or repeated pagination token");
  }
  seen.add(value);
  return value;
}
