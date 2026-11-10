import "server-only";
import { HttpError } from "./api";
import { safeEqual } from "./auth";

/** The render worker on your Mac authenticates with `Authorization: Bearer $WORKER_SECRET`. */
export function requireWorker(req: Request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new HttpError(503, "WORKER_SECRET is not set on the server");
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) throw new HttpError(401, "Unauthorized");
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
