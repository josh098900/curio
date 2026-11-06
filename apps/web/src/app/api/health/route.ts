import { databaseAnswers } from "@/server/health";

// Public on purpose: it says only whether the database answers, so it's the one route handler
// that doesn't check the user (.claude/rules/web.md). The health check calls it (spec §14.3).
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (await databaseAnswers()) {
    return Response.json({ status: "ok" }, { headers });
  }
  return Response.json({ message: "UNAVAILABLE" }, { status: 503, headers });
}
