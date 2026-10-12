export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in again.') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = "You don't have access to that.") => new ApiError(403, 'forbidden', message);
export const notFound = (what = 'Item') => new ApiError(404, 'not_found', `${what} not found.`);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const tooMany = (message: string) => new ApiError(429, 'rate_limited', message);
