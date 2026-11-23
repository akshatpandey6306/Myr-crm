const PAYU_CHECKOUT_HOSTS = new Set(["secure.payu.in", "test.payu.in"]);
const PAYU_NAVIGATION_TIMEOUT_MS = 15_000;

export function postPayUCheckout(checkoutUrl: string, fields: Record<string, unknown>): Promise<void> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("PayU returned invalid checkout fields.");
  }
  const action = new URL(checkoutUrl);
  if (action.protocol !== "https:" || !PAYU_CHECKOUT_HOSTS.has(action.hostname) || action.pathname !== "/_payment") {
    throw new Error("PayU returned an unsupported checkout destination.");
  }
  for (const requiredField of ["key", "txnid", "amount", "productinfo", "firstname", "email", "phone", "surl", "furl", "hash"]) {
    if (typeof fields[requiredField] !== "string" || !fields[requiredField]) {
      throw new Error("PayU returned incomplete checkout fields.");
    }
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = action.toString();
  form.target = "_self";
  form.acceptCharset = "UTF-8";
  form.hidden = true;

  for (const [name, value] of Object.entries(fields)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name) || typeof value !== "string") continue;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pagehide", onPageHide);
    };
    const onPageHide = () => {
      cleanup();
      resolve();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      form.remove();
      reject(new Error("PayU did not open. Check your connection and browser settings, then try again."));
    }, PAYU_NAVIGATION_TIMEOUT_MS);

    window.addEventListener("pagehide", onPageHide, { once: true });
    try {
      const nativeForm = HTMLFormElement.prototype;
      if (typeof nativeForm.requestSubmit === "function") nativeForm.requestSubmit.call(form);
      else nativeForm.submit.call(form);
    } catch (error) {
      cleanup();
      form.remove();
      reject(error instanceof Error ? error : new Error("Could not submit the PayU checkout form."));
    }
  });
}
