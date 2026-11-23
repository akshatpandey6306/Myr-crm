import { afterEach, describe, expect, it, vi } from "vitest";
import { postPayUCheckout } from "./payu-checkout";

const checkoutFields = {
  key: "merchant-key",
  txnid: "transaction-id",
  amount: "59.00",
  productinfo: "LeadPilot Starter",
  firstname: "Aditya",
  email: "aditya@example.com",
  phone: "6306443348",
  surl: "https://crm.example.com/api/v1/billing/payu/return",
  furl: "https://crm.example.com/api/v1/billing/payu/return",
  hash: "signed-hash",
  udf1: "payment-id",
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("PayU checkout form", () => {
  it.each(["https://secure.payu.in/_payment", "https://test.payu.in/_payment"])(
    "posts signed fields to the same tab at %s",
    async (checkoutUrl) => {
      const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});

      const navigation = postPayUCheckout(checkoutUrl, checkoutFields);

      const form = document.querySelector("form");
      expect(form).not.toBeNull();
      expect(form?.method).toBe("post");
      expect(form?.target).toBe("_self");
      expect(form?.action).toBe(checkoutUrl);
      expect(form?.hidden).toBe(true);
      expect(form?.querySelector<HTMLInputElement>('input[name="hash"]')?.value).toBe("signed-hash");
      expect(form?.querySelector<HTMLInputElement>('input[name="udf1"]')?.value).toBe("payment-id");
      expect(requestSubmit).toHaveBeenCalledOnce();
      window.dispatchEvent(new Event("pagehide"));
      await expect(navigation).resolves.toBeUndefined();
    },
  );

  it("rejects insecure, unknown, or malformed checkout destinations", async () => {
    expect(() => postPayUCheckout("http://test.payu.in/_payment", checkoutFields)).toThrow(/unsupported checkout destination/);
    expect(() => postPayUCheckout("https://attacker.example/_payment", checkoutFields)).toThrow(/unsupported checkout destination/);
    expect(() => postPayUCheckout("https://secure.payu.in/other", checkoutFields)).toThrow(/unsupported checkout destination/);
    expect(document.querySelector("form")).toBeNull();
  });

  it("rejects incomplete signed fields without posting an empty payment", async () => {
    expect(() => postPayUCheckout("https://secure.payu.in/_payment", { key: "merchant-key" })).toThrow(/incomplete checkout fields/);
    expect(document.querySelector("form")).toBeNull();
  });

  it("fails clearly and removes the form when the browser does not navigate to PayU", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    const navigation = postPayUCheckout("https://secure.payu.in/_payment", checkoutFields);
    const rejected = expect(navigation).rejects.toThrow(/PayU did not open/);

    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(document.querySelector("form")).toBeNull();
    vi.useRealTimers();
  });
});
