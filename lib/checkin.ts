// Today's check-in card, shared by the page (server) and the card (client).
export type CheckinKind = "morning" | "evening";

// Check-ins swiped away, as "YYYY-MM-DD:kind" values joined by "|".
export const CHECKIN_DISMISSED_COOKIE = "checkin-dismissed";
