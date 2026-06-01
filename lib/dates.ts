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
