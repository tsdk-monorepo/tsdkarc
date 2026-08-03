import type { HttpMeta, RpcErrorCode, RpcErrorIssue } from "./types";

export class HttpResponse<T> {
  constructor(public readonly body: T, public readonly meta: HttpMeta = {}) {}
}

export const HTTP = {
  send<T>(body: T, meta: HttpMeta = {}): HttpResponse<T> {
    return new HttpResponse(body, meta);
  },
  redirect(
    url: string,
    status: 301 | 302 | 307 | 308 = 302
  ): HttpResponse<never> {
    return new HttpResponse<never>(undefined as never, {
      status,
      headers: { Location: url },
    });
  },
};

export class RpcError extends Error {
  public readonly name = "RpcError";
  constructor(
    public code: RpcErrorCode,
    public message: string,
    public issues?: RpcErrorIssue[]
  ) {
    super(message);
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

export function isRpcError(error: unknown): error is RpcError {
  return error instanceof Error && error.name === "RpcError";
}
