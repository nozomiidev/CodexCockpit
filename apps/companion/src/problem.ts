import type { FastifyReply } from "fastify";

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly instance?: string;
}

export class CompanionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly type = "about:blank",
  ) {
    super(message);
    this.name = "CompanionError";
  }
}

export function sendProblem(reply: FastifyReply, problem: ProblemDetails): FastifyReply {
  return reply.type("application/problem+json").code(problem.status).send(problem);
}

export function toProblem(error: unknown, instance?: string): ProblemDetails {
  if (error instanceof CompanionError) {
    return {
      type: error.type,
      title: titleFor(error.status),
      status: error.status,
      detail: error.message,
      code: error.code,
      ...(instance === undefined ? {} : { instance }),
    };
  }
  return {
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
    detail: "The companion could not complete the request.",
    code: "internal_error",
    ...(instance === undefined ? {} : { instance }),
  };
}

function titleFor(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 409) return "Conflict";
  if (status === 503) return "Service Unavailable";
  return "Request Failed";
}
