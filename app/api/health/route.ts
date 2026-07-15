import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Health check + keep-alive.
 *
 * Runs a tiny real query against the database. Two purposes:
 *  1. Keeps the Supabase project "active" (the free plan pauses a project after
 *     7 days without database activity — a paused project takes the whole site
 *     down with 504s).
 *  2. Gives an uptime monitor (UptimeRobot…) something to ping: it returns 503
 *     when the database is unreachable, so you get alerted before your client does.
 *
 * Safe to expose: it uses the anon client, so RLS applies and no row is ever
 * returned — only a count on an empty-for-anon result.
 */
export async function GET() {
  const started = Date.now();
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("restaurants")
      .select("id", { head: true, count: "exact" });
    const ms = Date.now() - started;

    if (error) {
      return NextResponse.json({ ok: false, db: "error", ms }, { status: 503 });
    }
    return NextResponse.json({ ok: true, db: "up", ms }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, db: "unreachable", ms: Date.now() - started }, { status: 503 });
  }
}
