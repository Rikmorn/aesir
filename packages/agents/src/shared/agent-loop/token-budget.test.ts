/**
 * Tests for TokenBudget
 *
 * Verifies the token budget counter including:
 * - Basic deduction and exhaustion
 * - Warning threshold (20% remaining)
 * - Reserve buffer (5000 tokens)
 * - warningFired flag behavior
 * - Edge cases (zero budget, exact thresholds)
 */

import { describe, expect, it } from "vitest";
import {
  createTokenBudget,
  RESERVE_BUFFER,
  WARNING_THRESHOLD_RATIO,
} from "./token-budget.js";

describe("TokenBudget", () => {
  // -------------------------------------------------------------------------
  // Basic behavior
  // -------------------------------------------------------------------------

  it("creates budget with correct initial values", () => {
    const budget = createTokenBudget(100_000);
    expect(budget.total).toBe(100_000);
    expect(budget.remaining).toBe(100_000);
    expect(budget.warningFired).toBe(false);
  });

  it("deducts tokens correctly", () => {
    const budget = createTokenBudget(10_000);
    budget.deduct(500, 200);
    expect(budget.remaining).toBe(9_300);
  });

  it("allows remaining to go negative", () => {
    const budget = createTokenBudget(100);
    budget.deduct(80, 50);
    expect(budget.remaining).toBe(-30);
  });

  // -------------------------------------------------------------------------
  // isExhausted()
  // -------------------------------------------------------------------------

  it("isExhausted() returns false when tokens remain", () => {
    const budget = createTokenBudget(1000);
    expect(budget.isExhausted()).toBe(false);
  });

  it("isExhausted() returns true when remaining is zero", () => {
    const budget = createTokenBudget(100);
    budget.deduct(50, 50);
    expect(budget.isExhausted()).toBe(true);
  });

  it("isExhausted() returns true when remaining is negative", () => {
    const budget = createTokenBudget(100);
    budget.deduct(100, 50);
    expect(budget.isExhausted()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // isWarning()
  // -------------------------------------------------------------------------

  it("isWarning() returns false above 20% remaining", () => {
    const budget = createTokenBudget(100_000);
    // 21% remaining (79K used)
    budget.deduct(40_000, 39_000);
    expect(budget.remaining).toBe(21_000);
    expect(budget.isWarning()).toBe(false);
  });

  it("isWarning() returns true at exactly 20% remaining", () => {
    const budget = createTokenBudget(100_000);
    // Exactly 20% remaining (80K used)
    budget.deduct(40_000, 40_000);
    expect(budget.remaining).toBe(20_000);
    expect(budget.isWarning()).toBe(true);
  });

  it("isWarning() returns true below 20% remaining", () => {
    const budget = createTokenBudget(100_000);
    // 10% remaining (90K used)
    budget.deduct(50_000, 40_000);
    expect(budget.remaining).toBe(10_000);
    expect(budget.isWarning()).toBe(true);
  });

  it("isWarning() threshold is 20%", () => {
    expect(WARNING_THRESHOLD_RATIO).toBe(0.2);
  });

  // -------------------------------------------------------------------------
  // isReserveOnly()
  // -------------------------------------------------------------------------

  it("isReserveOnly() returns false above 5000 tokens", () => {
    const budget = createTokenBudget(100_000);
    budget.deduct(45_000, 49_999);
    expect(budget.remaining).toBe(5_001);
    expect(budget.isReserveOnly()).toBe(false);
  });

  it("isReserveOnly() returns true at exactly 5000 tokens", () => {
    const budget = createTokenBudget(100_000);
    budget.deduct(50_000, 45_000);
    expect(budget.remaining).toBe(5_000);
    expect(budget.isReserveOnly()).toBe(true);
  });

  it("isReserveOnly() returns true below 5000 tokens", () => {
    const budget = createTokenBudget(100_000);
    budget.deduct(50_000, 46_000);
    expect(budget.remaining).toBe(4_000);
    expect(budget.isReserveOnly()).toBe(true);
  });

  it("reserve buffer is 5000 tokens", () => {
    expect(RESERVE_BUFFER).toBe(5_000);
  });

  // -------------------------------------------------------------------------
  // warningFired flag
  // -------------------------------------------------------------------------

  it("warningFired starts false", () => {
    const budget = createTokenBudget(100_000);
    expect(budget.warningFired).toBe(false);
  });

  it("warningFired can be set to true", () => {
    const budget = createTokenBudget(100_000);
    budget.warningFired = true;
    expect(budget.warningFired).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("handles budget of 0", () => {
    const budget = createTokenBudget(0);
    expect(budget.total).toBe(0);
    expect(budget.remaining).toBe(0);
    expect(budget.isExhausted()).toBe(true);
    expect(budget.isWarning()).toBe(true);
    expect(budget.isReserveOnly()).toBe(true);
  });

  it("handles budget exactly at warning threshold", () => {
    // Budget of 25000 -> 20% = 5000. At initial state remaining=25000, so not warning
    const budget = createTokenBudget(25_000);
    expect(budget.isWarning()).toBe(false);

    // Use 20001 tokens -> remaining = 4999 -> below 20% (5000)
    budget.deduct(10_000, 10_001);
    expect(budget.remaining).toBe(4_999);
    expect(budget.isWarning()).toBe(true);
  });

  it("handles small budget where warning and reserve overlap", () => {
    // Budget of 10000 -> 20% = 2000. Reserve = 5000.
    // At remaining = 2000: isWarning() is true (2000 <= 2000)
    // isReserveOnly() is also true (2000 <= 5000)
    // Both thresholds overlap when budget is small enough
    const budget = createTokenBudget(10_000);
    budget.deduct(5_000, 3_000);
    expect(budget.remaining).toBe(2_000);
    expect(budget.isWarning()).toBe(true);
    expect(budget.isReserveOnly()).toBe(true); // 2000 <= 5000
  });

  it("total remains readonly after deductions", () => {
    const budget = createTokenBudget(50_000);
    budget.deduct(10_000, 10_000);
    expect(budget.total).toBe(50_000);
    expect(budget.remaining).toBe(30_000);
  });
});
