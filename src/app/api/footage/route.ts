import { connection } from "next/server";
import { handle } from "@/lib/api";
import { createFootageUpload, deleteFootage, listFootage } from "@/lib/footage";

/** Footage library: list all files (grouped by topic in the UI). */
export async function GET() {
  await connection();
  return handle("list footage", () => listFootage());
}

/** Start an upload: returns a one-time signed path + token; the browser uploads the file to storage directly. */
export async function POST(req: Request) {
  return handle("start footage upload", async () => {
    const { game, name, size } = (await req.json().catch(() => ({}))) as { game?: string; name?: string; size?: number };
    return createFootageUpload(String(game ?? ""), String(name ?? ""), Number(size));
  });
}

export async function DELETE(req: Request) {
  return handle("delete footage", async () => {
    await deleteFootage(new URL(req.url).searchParams.get("path") ?? "");
    return { ok: true };
  });
}
