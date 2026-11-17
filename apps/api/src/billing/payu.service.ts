import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";

type PayUCheckoutInput = {
  transactionId: string;
  paymentId: string;
  amount: string;
  productInfo: string;
  firstName: string;
  email: string;
  phone: string;
};

export type PayUVerification = {
  status: "success" | "failure" | "pending";
  transactionId: string | null;
  amount: string | null;
  payuId: string | null;
  bankReference: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function sha512(value: string) {
  return createHash("sha512").update(value, "utf8").digest("hex");
}

function safeTextEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

@Injectable()
export class PayUService {
  isConfigured() {
    return Boolean(
      process.env.PAYU_MERCHANT_KEY?.trim() &&
      process.env.PAYU_MERCHANT_SALT?.trim() &&
      process.env.PAYU_CALLBACK_URL?.trim(),
    );
  }

  merchantKey() {
    return this.configuration().key;
  }

  createCheckout(input: PayUCheckoutInput) {
    const config = this.configuration();
    const callbackUrl = process.env.PAYU_CALLBACK_URL?.trim();
    if (!callbackUrl) throw this.notConfigured();
    let parsedCallback: URL;
    try {
      parsedCallback = new URL(callbackUrl);
    } catch {
      throw new ServiceUnavailableException({ code: "payu_callback_invalid", message: "PAYU_CALLBACK_URL must be an absolute URL" });
    }
    if (parsedCallback.protocol !== "https:" && !(config.mode === "test" && ["localhost", "127.0.0.1"].includes(parsedCallback.hostname))) {
      throw new ServiceUnavailableException({ code: "payu_callback_invalid", message: "PayU callbacks must use HTTPS outside local test mode" });
    }

    const udf1 = input.paymentId;
    const hashInput = [
      config.key,
      input.transactionId,
      input.amount,
      input.productInfo,
      input.firstName,
      input.email,
      udf1,
      "", "", "", "",
      "", "", "", "", "",
      config.salt,
    ].join("|");
    return {
      checkoutUrl: config.checkoutUrl,
      fields: {
        key: config.key,
        txnid: input.transactionId,
        amount: input.amount,
        productinfo: input.productInfo,
        firstname: input.firstName,
        email: input.email,
        phone: input.phone,
        surl: callbackUrl,
        furl: callbackUrl,
        udf1,
        udf2: "",
        udf3: "",
        udf4: "",
        udf5: "",
        hash: sha512(hashInput),
      },
    };
  }

  verifyCallbackHash(body: Record<string, unknown>) {
    const { key, salt } = this.configuration();
    const responseKey = text(body.key);
    const status = text(body.status);
    const callbackHash = text(body.hash);
    if (!responseKey || responseKey !== key || !status || !/^[a-f\d]{128}$/i.test(callbackHash)) return false;
    const additionalCharges = text(body.additional_charges);
    const common = [
      salt,
      status,
    ];
    const trailing = [
      "", "", "", "", "",
      text(body.udf5),
      text(body.udf4),
      text(body.udf3),
      text(body.udf2),
      text(body.udf1),
      text(body.email),
      text(body.firstname),
      text(body.productinfo),
      text(body.amount),
      text(body.txnid),
      responseKey,
    ];
    const chargesPrefix = additionalCharges && additionalCharges !== "0" && additionalCharges !== "0.00"
      ? [additionalCharges]
      : [];
    const splitInfo = text(body.splitInfo);
    // PayU's documented reverse hash has different shapes for standard and split
    // responses. Accept both exact formulas, with and without additional charges.
    const candidates = [
      [...chargesPrefix, ...common, ...trailing],
      [...chargesPrefix, ...common, ...(splitInfo ? [splitInfo] : []), ...trailing],
    ];
    return candidates.some((parts) => safeTextEqual(sha512(parts.join("|")), callbackHash));
  }

  async verifyPayment(transactionId: string): Promise<PayUVerification> {
    const config = this.configuration();
    const endpoint = config.mode === "live"
      ? "https://info.payu.in/merchant/postservice.php?form=2"
      : "https://test.payu.in/merchant/postservice.php?form=2";
    const hash = sha512(`${config.key}|verify_payment|${transactionId}|${config.salt}`);
    const body = new URLSearchParams({ key: config.key, command: "verify_payment", var1: transactionId, hash });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new ServiceUnavailableException({ code: "payu_verification_unavailable", message: "PayU payment verification is temporarily unavailable" });
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.transaction_details)) {
      throw new ServiceUnavailableException({ code: "payu_verification_invalid", message: "PayU returned an invalid verification response" });
    }
    const details = payload.transaction_details[transactionId];
    if (!isRecord(details)) {
      return { status: "pending", transactionId: null, amount: null, payuId: null, bankReference: null };
    }
    const status = text(details.status).toLowerCase();
    const unmappedStatus = text(details.unmappedstatus).toLowerCase();
    const finalStatus = status === "success" && unmappedStatus === "captured"
      ? "success"
      : status === "failure" || unmappedStatus === "failed" || unmappedStatus === "usercancelled"
        ? "failure"
        : "pending";
    return {
      status: finalStatus,
      transactionId: text(details.txnid) || transactionId,
      amount: text(details.amt ?? details.transaction_amount) || null,
      payuId: text(details.mihpayid) || null,
      bankReference: text(details.bank_ref_num) || null,
    };
  }

  private configuration() {
    const key = process.env.PAYU_MERCHANT_KEY?.trim();
    const salt = process.env.PAYU_MERCHANT_SALT?.trim();
    if (!key || !salt) throw this.notConfigured();
    const configuredMode = (process.env.PAYU_MODE ?? process.env.PAYU_ENV ?? "test").trim().toLowerCase();
    const mode = configuredMode === "production" ? "live" : configuredMode;
    if (mode !== "test" && mode !== "live") {
      throw new ServiceUnavailableException({ code: "payu_mode_invalid", message: "PAYU_MODE must be test, live, or production" });
    }
    return {
      key,
      salt,
      mode,
      checkoutUrl: mode === "live" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment",
    };
  }

  private notConfigured() {
    return new ServiceUnavailableException({
      code: "payu_not_configured",
      message: "PayU checkout is unavailable until merchant credentials and PAYU_CALLBACK_URL are configured on the API",
    });
  }
}
