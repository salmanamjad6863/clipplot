import { connection } from "next/server";
import { currentWorkspaceId } from "@/lib/workspaces";
import { handle } from "@/lib/api";
import { getStore } from "@/lib/data";

export async function GET() {
  await connection();
  return handle("list trends", async () => getStore(await currentWorkspaceId()).listTrends());
}
