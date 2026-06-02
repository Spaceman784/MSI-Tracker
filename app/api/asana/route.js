import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchWorkspaceData } from "@/lib/asana";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// simple in-memory cache so repeated loads are fast (60s)
let cache = { at: 0, data: null };

export async function GET(req) {
  // auth check
  const session = cookies().get(SESSION_COOKIE);
  if (!session || !verifySession(session.value)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const token = process.env.ASANA_TOKEN;
  if (!token || token === "paste-your-asana-token-here") {
    return NextResponse.json(
      {
        error: "NO_TOKEN",
        message:
          "Asana token not set. Open the .env.local file and paste your token into ASANA_TOKEN, then restart the dev server.",
      },
      { status: 400 }
    );
  }

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  if (!force && cache.data && Date.now() - cache.at < 60_000) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  try {
    const data = await fetchWorkspaceData(token, process.env.ASANA_WORKSPACE_GID);
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: "ASANA_ERROR", message: String(e && e.message ? e.message : e) },
      { status: 500 }
    );
  }
}
