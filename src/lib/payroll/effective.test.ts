import { describe, expect, it } from "vitest";
import { resolveEffective, resolveEffectiveWithOverride } from "./effective.ts";

const row = (
	effectiveFrom: string,
	effectiveTo: string | null,
	tag: string,
) => ({
	effectiveFrom,
	effectiveTo,
	tag,
});

describe("resolveEffective", () => {
	const rows = [
		row("2025-01-01", "2025-12-31", "2025"),
		row("2026-01-01", null, "2026-onwards"),
	];

	it("picks the version in force", () => {
		expect(resolveEffective(rows, "2025-06-15")?.tag).toBe("2025");
		expect(resolveEffective(rows, "2026-06-15")?.tag).toBe("2026-onwards");
	});

	it("is correct on both sides of the seam", () => {
		expect(resolveEffective(rows, "2025-12-31")?.tag).toBe("2025");
		expect(resolveEffective(rows, "2026-01-01")?.tag).toBe("2026-onwards");
	});

	it("returns null before anything takes effect, rather than a silent default", () => {
		expect(resolveEffective(rows, "2024-12-31")).toBeNull();
		expect(resolveEffective([], "2026-01-01")).toBeNull();
	});

	it("prefers the most recently started version when several overlap", () => {
		const overlapping = [
			row("2026-01-01", null, "old"),
			row("2026-07-01", null, "raise"),
		];
		expect(resolveEffective(overlapping, "2026-08-15")?.tag).toBe("raise");
		expect(resolveEffective(overlapping, "2026-06-30")?.tag).toBe("old");
	});
});

describe("resolveEffectiveWithOverride", () => {
	const global2026 = { ...row("2026-01-01", null, "global"), userId: null };
	const mine = { ...row("2026-01-01", null, "mine"), userId: "user_a" };

	it("prefers the user's own row over a global one", () => {
		expect(
			resolveEffectiveWithOverride([global2026, mine], "2026-08-15")?.tag,
		).toBe("mine");
	});

	it("falls back to the global row when the user has none", () => {
		expect(resolveEffectiveWithOverride([global2026], "2026-08-15")?.tag).toBe(
			"global",
		);
	});

	it("does not let an expired override shadow a live global row", () => {
		const expired = {
			...row("2025-01-01", "2025-12-31", "old-mine"),
			userId: "user_a",
		};
		expect(
			resolveEffectiveWithOverride([global2026, expired], "2026-08-15")?.tag,
		).toBe("global");
	});
});
