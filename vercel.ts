import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project config.
 * Hobby plan allows one cron run per day → this is the daily BACKUP trigger (discovery + scripts).
 * The precise clock is the worker on your Mac, which ticks every 5 minutes.
 * 12:00 UTC = default discovery time (upload 16:00 UTC − 4h). Vercel may run it any time within that hour.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  crons: [{ path: "/api/cron/tick", schedule: "0 12 * * *" }],
};
