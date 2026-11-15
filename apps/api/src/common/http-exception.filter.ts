import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { HttpResponse } from "./http.types.js";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<HttpResponse>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let message = "Unexpected error";
    let details: unknown = null;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
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
        code = (o.code as string) ?? code;
        details = o.details ?? null;
      }
    } else {
      this.logger.error("Unhandled API exception", exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json({ error: { code, message, details } });
  }
}
