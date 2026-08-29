import { prisma } from "@/lib/prisma";

// Retention job: delete ErrorLog rows older than 90 days.
// Intended to be run via cron/pg_cron or as an npm script.

async function main() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const res = await prisma.errorLog.deleteMany({
    where: {
      timestamp: {
        lt: cutoff,
      },
    },
  });

  // eslint-disable-next-line no-console
  console.info(
    `[cleanup_error_logs] deleted=${res.count} cutoff=${cutoff.toISOString()}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[cleanup_error_logs] failed:", err);
  process.exit(1);
});
