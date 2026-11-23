import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password hashing", () => {
  it("verifies a correct password and rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
    assert.equal(await verifyPassword("incorrect password", hash), false);
  });

  it("uses a different random salt for each hash of the same password", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    assert.notEqual(first.split("$")[1], second.split("$")[1]);
    assert.notEqual(first, second);
  });

  it("continues verifying password hashes created by the previous synchronous implementation", async () => {
    const salt = Buffer.alloc(16, 7);
    const legacyHash = `scrypt$${salt.toString("hex")}$${scryptSync("legacy password", salt, 64).toString("hex")}`;

    assert.equal(await verifyPassword("legacy password", legacyHash), true);
  });

  it("rejects malformed and unsupported stored hashes without deriving a key", async () => {
    assert.equal(await verifyPassword("password", ""), false);
    assert.equal(await verifyPassword("password", "bcrypt$bad$hash"), false);
    assert.equal(await verifyPassword("password", "scrypt$invalid$hash"), false);
  });

  it("rejects an empty supplied password", async () => {
    const hash = await hashPassword("not empty");
    assert.equal(await verifyPassword("", hash), false);
  });
});
