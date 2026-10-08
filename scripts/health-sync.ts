// Local Google Health sync: npm run health:sync -- [--user NAME] [--types a b] [--start YYYY-MM-DD]
// Reads GOOGLE_* and DATABASE_URL from .env.local.
import { addDays, isValidLocalDate, todayLocalDate } from "../lib/dates";
import { GoogleHealthClient, HEALTH_DATA_TYPES, isHealthDataType, type HealthDataType } from "../lib/health/google";
import { syncHealth } from "../lib/health/sync";
import { getPool } from "../lib/supabase";

function parseArgs(argv: string[]) {
  const options: { user?: string; types: HealthDataType[]; start?: string } = { types: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--user") {
      options.user = argv[++index];
    } else if (arg === "--start") {
      options.start = argv[++index];
    } else if (arg === "--types") {
      while (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        const kind = argv[++index];
        if (!isHealthDataType(kind)) {
          throw new Error(`Unknown data type: ${kind}. Choose from: ${HEALTH_DATA_TYPES.join(", ")}`);
        }
        options.types.push(kind);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.start && !isValidLocalDate(options.start)) {
    throw new Error("--start must be YYYY-MM-DD");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const userName = options.user || process.env.GOOGLE_HEALTH_USER;
  if (!userName) {
    throw new Error("Pass --user or set GOOGLE_HEALTH_USER");
  }
  const db = getPool();
  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  try {
    const failures = await syncHealth(db, new GoogleHealthClient(), {
      userName,
      types: options.types.length ? options.types : HEALTH_DATA_TYPES,
      end: addDays(todayLocalDate(), 1),
      replayFrom: options.start
    });
    process.exitCode = failures ? 1 : 0;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`Health sync failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
