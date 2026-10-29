import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { HttpResponse } from "./http.types.js";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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
      if (typeof r === "string") message = r;
      else if (r && typeof r === "object") {
        const o = r as Record<string, unknown>;
        message = (o.message as string) ?? message;
        code = (o.code as string) ?? code;
        details = o.details ?? null;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }
    res.status(status).json({ error: { code, message, details } });
  }
}
