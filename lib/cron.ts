import { timingSafeEqual } from "crypto";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return (
    Boolean(secret) &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}
