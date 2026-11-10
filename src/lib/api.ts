import "server-only";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps a route handler: JSON errors, logging, no stack traces leaked to the client. */
export async function handle<T>(label: string, fn: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error(`[api] ${label} failed:`, err);
    return Response.json({ error: "Something went wrong — check the server logs" }, { status: 500 });
  }
}
