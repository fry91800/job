// An error with an HTTP status and a stable code the web app can switch on. `details`
// carries data the client needs to react (e.g. the alternative resume of M1).
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
