import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, InternalServerErrorException } from "@nestjs/common";
import { HttpExceptionFilter } from "../src/common/http-exception.filter.js";

function captureResponse() {
  let statusCode = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
    setHeader() {},
  };
  return { response, getResult: () => ({ statusCode, body }) };
}

function makeHost(response: ReturnType<typeof captureResponse>["response"]) {
  return {
    switchToHttp: () => ({ getResponse: () => response }),
  };
}

describe("HttpExceptionFilter", () => {
  it("preserves structured client errors and normalizes validation messages", () => {
    const result = captureResponse();
    const filter = new HttpExceptionFilter();

    filter.catch(new BadRequestException({ code: "validation_error", message: ["name is required", "email is invalid"] }), makeHost(result.response) as never);

    assert.deepEqual(result.getResult(), {
      statusCode: 400,
      body: { error: { code: "validation_error", message: "name is required, email is invalid", details: null } },
    });
  });

  it("does not expose internal server error messages", () => {
    const result = captureResponse();
    const filter = new HttpExceptionFilter();

    filter.catch(new InternalServerErrorException("database password leaked"), makeHost(result.response) as never);

    assert.deepEqual(result.getResult(), {
      statusCode: 500,
      body: { error: { code: "internal_error", message: "Unexpected error", details: null } },
    });
  });
});
