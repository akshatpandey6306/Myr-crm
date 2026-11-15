import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { HttpResponse } from "./http.types.js";

function defaultCodeForStatus(status: number) {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "bad_request";
    case HttpStatus.UNAUTHORIZED:
      return "unauthorized";
    case HttpStatus.FORBIDDEN:
      return "forbidden";
    case HttpStatus.NOT_FOUND:
      return "not_found";
    case HttpStatus.CONFLICT:
      return "conflict";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "rate_limited";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "service_unavailable";
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? "internal_error" : "request_error";
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<HttpResponse>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = defaultCodeForStatus(status);
    let message = "Unexpected error";
    let details: unknown = null;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = defaultCodeForStatus(status);
      const r = exception.getResponse();
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error("Unhandled HTTP exception", exception.stack);
      }
      if (typeof r === "string" && status < HttpStatus.INTERNAL_SERVER_ERROR) {
        message = r;
      } else if (r && typeof r === "object" && (status < HttpStatus.INTERNAL_SERVER_ERROR || "code" in r)) {
        const o = r as Record<string, unknown>;
        if (typeof o.message === "string") message = o.message;
        else if (Array.isArray(o.message)) message = o.message.filter((item): item is string => typeof item === "string").join(", ") || message;
        if (typeof o.code === "string" && o.code.trim()) code = o.code;
        details = o.details ?? null;
      }
    } else {
      this.logger.error("Unhandled API exception", exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json({ error: { code, message, details } });
  }
}
