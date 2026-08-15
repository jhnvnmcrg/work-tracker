import { describe, expect, it } from "vitest";
import {
	applyPpm,
	formatPeso,
	mulDivRound,
	parseCentavos,
	pesosToCentavos,
	splitCentavosExact,
	toPesoString,
} from "./money.ts";

describe("mulDivRound", () => {
	it("computes exact division without rounding", () => {
		expect(mulDivRound(100, 3, 1)).toBe(300);
		expect(mulDivRound(1000, 1, 4)).toBe(250);
		expect(mulDivRound(0, 12345, 7)).toBe(0);
	});

	it("rounds half away from zero in both directions", () => {
		// 5/2 = 2.5 -> 3, and -5/2 = -2.5 -> -3.
		expect(mulDivRound(5, 1, 2)).toBe(3);
		expect(mulDivRound(-5, 1, 2)).toBe(-3);
		expect(mulDivRound(5, -1, 2)).toBe(-3);
		// Math.round would give -2 here, treating a deduction differently from
		// an earning of the same size.
		expect(mulDivRound(-5, 1, 2)).not.toBe(-2);
	});

	it("rounds below and above the halfway point correctly", () => {
		expect(mulDivRound(4, 1, 3)).toBe(1); // 1.33
		expect(mulDivRound(5, 1, 3)).toBe(2); // 1.67
		expect(mulDivRound(-4, 1, 3)).toBe(-1);
		expect(mulDivRound(-5, 1, 3)).toBe(-2);
	});

	it("survives intermediates that overflow a JS number", () => {
		// A ₱1,000,000 monthly rate: 100_000_000 centavos x 1200 x 1e6 is 1.2e17,
		// well past Number.MAX_SAFE_INTEGER (9.007e15).
		const monthlyCentavos = 100_000_000;
		const result = mulDivRound(monthlyCentavos, 1200 * 1_000_000, 31_300);
		// Cross-checked against exact BigInt arithmetic.
		const exact =
			(BigInt(monthlyCentavos) * BigInt(1200 * 1_000_000)) / BigInt(31_300);
		expect(BigInt(result) - exact).toBeLessThanOrEqual(1n);
		expect(Number.isSafeInteger(result)).toBe(true);
	});

	it("matches exact BigInt arithmetic across many inputs", () => {
		for (let value = -5_000; value <= 5_000; value += 137) {
			for (const denominator of [3, 7, 60, 313, 31_300]) {
				const actual = mulDivRound(value, 1_000_000, denominator);
				const product = BigInt(value) * 1_000_000n;
				const d = BigInt(denominator);
				const negative = product < 0n;
				const abs = negative ? -product : product;
				const q = abs / d;
				const r = abs % d;
				const rounded = r * 2n >= d ? q + 1n : q;
				const expected = Number(negative ? -rounded : rounded);
				expect(actual, `${value}/${denominator}`).toBe(expected);
			}
		}
	});

	it("refuses a zero denominator and non-integer inputs", () => {
		expect(() => mulDivRound(1, 1, 0)).toThrow(/denominator/);
		expect(() => mulDivRound(1.5, 1, 2)).toThrow(/integers/);
	});
});

describe("applyPpm", () => {
	it("applies a percentage", () => {
		expect(applyPpm(1_000_000, 50_000)).toBe(50_000); // 5%
		expect(applyPpm(2_500_000, 1_250_000)).toBe(3_125_000); // 1.25x
	});

	it("rounds the result once", () => {
		// 333 x 5% = 16.65 -> 17
		expect(applyPpm(333, 50_000)).toBe(17);
	});
});

describe("splitCentavosExact", () => {
	it("splits evenly when it divides", () => {
		expect(splitCentavosExact(1000, 2)).toEqual([500, 500]);
		expect(splitCentavosExact(900, 3)).toEqual([300, 300, 300]);
	});

	it("puts the remainder on the last part", () => {
		expect(splitCentavosExact(1001, 2)).toEqual([500, 501]);
		expect(splitCentavosExact(100, 3)).toEqual([33, 33, 34]);
	});

	it("handles negative totals", () => {
		expect(splitCentavosExact(-1001, 2)).toEqual([-500, -501]);
	});

	it("always sums exactly to the total", () => {
		// The invariant that makes two semi-monthly halves add up to the month.
		for (let total = -20_003; total <= 20_003; total += 61) {
			for (const parts of [1, 2, 3, 4, 12, 24]) {
				const split = splitCentavosExact(total, parts);
				expect(split).toHaveLength(parts);
				expect(
					split.reduce((a, b) => a + b, 0),
					`${total}/${parts}`,
				).toBe(total);
			}
		}
	});

	it("rejects a nonsensical part count", () => {
		expect(() => splitCentavosExact(100, 0)).toThrow();
		expect(() => splitCentavosExact(100, 1.5)).toThrow();
	});
});

describe("parseCentavos", () => {
	it("reads the string Postgres returns for SUM(bigint)", () => {
		expect(parseCentavos("4500000")).toBe(4_500_000);
		expect(parseCentavos("-250")).toBe(-250);
	});

	it("passes integers through and treats null as zero", () => {
		expect(parseCentavos(1234)).toBe(1234);
		expect(parseCentavos(null)).toBe(0);
		expect(parseCentavos(undefined)).toBe(0);
	});

	it("refuses anything that is not whole centavos", () => {
		expect(() => parseCentavos("12.5")).toThrow();
		expect(() => parseCentavos(12.5)).toThrow();
		expect(() => parseCentavos("abc")).toThrow();
	});
});

describe("pesosToCentavos", () => {
	it.each([
		["45000", 4_500_000],
		["45,000", 4_500_000],
		["45000.50", 4_500_050],
		["45000.5", 4_500_050],
		["₱45,000.50", 4_500_050],
		["0.01", 1],
		["-12.34", -1234],
		["", 0],
	])("reads %j as %i centavos", (input, expected) => {
		expect(pesosToCentavos(input)).toBe(expected);
	});

	it("refuses more than two decimal places", () => {
		expect(() => pesosToCentavos("1.234")).toThrow();
		expect(() => pesosToCentavos("abc")).toThrow();
	});

	it("round-trips through toPesoString", () => {
		for (const centavos of [0, 1, 99, 100, 4_500_050, -1234]) {
			expect(pesosToCentavos(toPesoString(centavos))).toBe(centavos);
		}
	});
});

describe("formatPeso", () => {
	it("formats with the peso sign and two decimals", () => {
		expect(formatPeso(2_250_000)).toBe("₱22,500.00");
		expect(formatPeso(0)).toBe("₱0.00");
		expect(formatPeso(1)).toBe("₱0.01");
	});
});
