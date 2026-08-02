import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { checkAccountWrite, guardAccountCreate } from "../lib/account-tiers";
import { AUTH } from "@flyff/entities/constants/authority";

// The panel admits anyone >= GAMEMASTER, so a tier-1 GM is the attacker to beat.
const GM = { id: 10, authority: AUTH.GAMEMASTER };
const OPERATOR = { id: 11, authority: AUTH.OPERATOR };
const ADMIN = { id: 12, authority: AUTH.ADMINISTRATOR };

describe("account-guard -- write", () => {
  it("blocks self-edit so a GM cannot lift their own ceiling", () => {
    assert.equal(
      checkAccountWrite(GM, GM.id, GM.authority, AUTH.ADMINISTRATOR),
      "You cannot modify your own account",
    );
    // Even a password-only self-edit is refused (no newAuthority passed).
    assert.equal(
      checkAccountWrite(ADMIN, ADMIN.id, ADMIN.authority, undefined),
      "You cannot modify your own account",
    );
  });

  it("blocks acting on a peer or a superior", () => {
    const peer = "That account's authority is equal to or above yours";
    assert.equal(checkAccountWrite(GM, 99, AUTH.GAMEMASTER, undefined), peer);
    assert.equal(checkAccountWrite(GM, 99, AUTH.ADMINISTRATOR, undefined), peer);
    assert.equal(checkAccountWrite(OPERATOR, 99, AUTH.ADMINISTRATOR, undefined), peer);
  });

  it("blocks a GM from granting any tier at all", () => {
    assert.equal(
      checkAccountWrite(GM, 99, AUTH.GENERAL, AUTH.GENERAL),
      "Changing authority requires Operator or above",
    );
  });

  it("blocks granting a tier at or above the actor's own", () => {
    const tooHigh = "You cannot grant an authority at or above your own";
    assert.equal(checkAccountWrite(OPERATOR, 99, AUTH.GENERAL, AUTH.OPERATOR), tooHigh);
    assert.equal(checkAccountWrite(OPERATOR, 99, AUTH.GENERAL, AUTH.ADMINISTRATOR), tooHigh);
    assert.equal(checkAccountWrite(ADMIN, 99, AUTH.GENERAL, AUTH.ADMINISTRATOR), tooHigh);
  });

  it("allows a GM to edit a plain player without touching authority", () => {
    assert.equal(checkAccountWrite(GM, 99, AUTH.GENERAL, undefined), null);
  });

  it("allows an admin to promote a player below their own tier", () => {
    assert.equal(checkAccountWrite(ADMIN, 99, AUTH.GENERAL, AUTH.GAMEMASTER3), null);
    assert.equal(checkAccountWrite(ADMIN, 99, AUTH.GAMEMASTER, AUTH.OPERATOR), null);
  });
});

describe("account-guard -- create", () => {
  it("lets any signed-in GM mint a plain player", () => {
    assert.equal(guardAccountCreate(GM, AUTH.GENERAL), null);
  });

  it("blocks a GM from minting staff", () => {
    assert.equal(
      guardAccountCreate(GM, AUTH.GAMEMASTER),
      "Creating a staff account requires Operator or above",
    );
  });

  it("blocks minting at or above the actor's own tier", () => {
    const tooHigh = "You cannot grant an authority at or above your own";
    assert.equal(guardAccountCreate(ADMIN, AUTH.ADMINISTRATOR), tooHigh);
    assert.equal(guardAccountCreate(OPERATOR, AUTH.ADMINISTRATOR), tooHigh);
  });

  it("lets an admin mint staff below their own tier", () => {
    assert.equal(guardAccountCreate(ADMIN, AUTH.GAMEMASTER), null);
    assert.equal(guardAccountCreate(ADMIN, AUTH.OPERATOR), null);
  });
});
