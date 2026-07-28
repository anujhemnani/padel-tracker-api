import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Club definitions
// NOTE: 3 tenant IDs are not yet confirmed – replace the placeholder values
//       with the real Playtomic tenant UUIDs once you have them.
// ---------------------------------------------------------------------------
const CLUBS = [
  {
    name: "iPadel Melbourne",
    tenantId: "ad338542-1b25-4b7e-9399-4bce72656352",
  },
  {
    name: "G4P Docklands",
    tenantId: "916ccd8a-d212-43c8-98fd-5f2eec2ea4f1",
  },
  {
    name: "G4P Richmond",
    tenantId: "fd015cf7-b26b-4f7b-9a1f-8ed26f97ca05",
  },
  {
    name: "Recess Padel Club",
    tenantId: "56fdf01c-81a5-470c-9188-e7312d19d985",
  },
  {
    name: "South East Padel",
    tenantId: "b5a636e5-35d0-421b-b823-d857b8c9f088",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as a Playtomic-style local datetime string (no timezone). */
function toLocalDT(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const PLAYTOMIC_COOKIE = process.env["PLAYTOMIC_COOKIE"] ?? "";

/** Fetch availability for a single club from Playtomic. */
async function fetchClubAvailability(
  club: (typeof CLUBS)[number],
  localStartMin: string,
  localStartMax: string,
  duration: number,
): Promise<{ club: string; tenantId: string; slots: unknown[] | null; error?: string }> {
  if (club.tenantId.startsWith("UNKNOWN")) {
    return { club: club.name, tenantId: club.tenantId, slots: null, error: "Tenant ID not configured" };
  }

  const params = new URLSearchParams({
    user_id: "me",
    tenant_id: club.tenantId,
    sport_id: "PADEL",
    local_start_min: localStartMin,
    local_start_max: localStartMax,
    duration: String(duration),
  });

  const url = `https://api.playtomic.io/v1/availability?${params.toString()}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "Referer": "https://playtomic.com/",
  };
  if (PLAYTOMIC_COOKIE) {
    headers["Cookie"] = PLAYTOMIC_COOKIE;
  }

  try {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        club: club.name,
        tenantId: club.tenantId,
        slots: null,
        error: `Playtomic returned ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = await res.json() as unknown[];
    return { club: club.name, tenantId: club.tenantId, slots: data };
  } catch (err) {
    return {
      club: club.name,
      tenantId: club.tenantId,
      slots: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/healthz
 * Basic health check.
 */
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * GET /api/scan
 *
 * Query params (all optional):
 *   date      – YYYY-MM-DD of the day to scan (defaults to today in UTC)
 *   duration  – slot duration in minutes (default: 90)
 *
 * Returns an array of results, one per club, in the shape:
 *   { club, tenantId, slots, error? }
 */
app.get("/api/scan", async (req, res) => {
  // Parse query params
  const dateParam = typeof req.query.date === "string" ? req.query.date : null;
  const durationParam = typeof req.query.duration === "string" ? parseInt(req.query.duration, 10) : NaN;
  const duration = !isNaN(durationParam) && durationParam > 0 ? durationParam : 90;

  let scanDate: Date;
  if (dateParam) {
    scanDate = new Date(`${dateParam}T00:00:00`);
    if (isNaN(scanDate.getTime())) {
      res.status(400).json({ error: "Invalid date – use YYYY-MM-DD format" });
      return;
    }
  } else {
    const now = new Date();
    scanDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const endOfDay = new Date(scanDate);
  endOfDay.setHours(23, 59, 59, 0);

  const localStartMin = toLocalDT(scanDate);
  const localStartMax = toLocalDT(endOfDay);

  // Fetch all clubs in parallel
  const results = await Promise.all(
    CLUBS.map((club) => fetchClubAvailability(club, localStartMin, localStartMax, duration)),
  );

  res.json({
    date: dateParam ?? scanDate.toISOString().slice(0, 10),
    duration,
    results,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const port = Number(process.env["PORT"]);
if (!port || isNaN(port)) {
  console.error("PORT environment variable is required");
  process.exit(1);
}

app.listen(port, () => {
  console.log(`padel-tracker-backend listening on port ${port}`);
});
