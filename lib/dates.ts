export function todayLocalDate() {
  const timeZone = process.env.APP_TIME_ZONE || "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export function isValidLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(entryDate: string, days: number) {
  const date = new Date(`${entryDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function rollingDateWindow(endDate: string, days: number) {
  return Array.from({ length: days }, (_, index) => addDays(endDate, index - days + 1));
}

export function currentWeekToDate(entryDate: string) {
  const date = new Date(`${entryDate}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: entryDate,
    elapsedDays: daysSinceMonday + 1
  };
}
