import { connection } from "next/server";
import { handle } from "@/lib/api";
import { getStore } from "@/lib/data";

export async function GET() {
  await connection();
  return handle("list clips", () => getStore().listClips());
}
