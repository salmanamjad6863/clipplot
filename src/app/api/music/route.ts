import { connection } from "next/server";
import { handle } from "@/lib/api";
import { createMusicUpload, deleteMusic, listMusic } from "@/lib/footage";

/** Music library (Settings): list / start an upload / delete. */
export async function GET() {
  await connection();
  return handle("list music", () => listMusic());
}

export async function POST(req: Request) {
  return handle("start music upload", async () => {
    const { mood, name, size } = (await req.json().catch(() => ({}))) as { mood?: string; name?: string; size?: number };
    return createMusicUpload(String(mood ?? ""), String(name ?? ""), Number(size));
  });
}

export async function DELETE(req: Request) {
  return handle("delete music", async () => {
    await deleteMusic(new URL(req.url).searchParams.get("path") ?? "");
    return { ok: true };
  });
}
