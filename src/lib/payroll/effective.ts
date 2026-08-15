/**
 * Effective-dated record resolution.
 *
 * Employment terms, work schedules, holidays and contribution tables are all
 * versioned rather than mutable, so that a change made today cannot retroactively
 * alter what a past payslip means. Picking the right version is the same problem
 * every time, so it lives here once.
 */

export interface EffectiveDated {
	effectiveFrom: string;
	effectiveTo: string | null;
}

/** Whether `row` is in force on `onDate`. Dates compare correctly as strings. */
export function coversDate(row: EffectiveDated, onDate: string): boolean {
	return (
		row.effectiveFrom <= onDate &&
		(row.effectiveTo === null || row.effectiveTo >= onDate)
	);
}

/**
 * The version in force on `onDate`; the most recently started one when several
 * overlap. Returns null when nothing covers the date — callers must treat that
 * as an explicit error rather than substituting a zero.
 */
export function resolveEffective<T extends EffectiveDated>(
	rows: readonly T[],
	onDate: string,
): T | null {
	let best: T | null = null;
	for (const row of rows) {
		if (!coversDate(row, onDate)) continue;
		if (best === null || row.effectiveFrom > best.effectiveFrom) best = row;
	}
	return best;
}

/**
 * As {@link resolveEffective}, but a row owned by the user beats a global one
 * covering the same date.
 *
 * This is what makes seeded reference data editable per user without letting one
 * person's correction change anybody else's payroll.
 */
export function resolveEffectiveWithOverride<
	T extends EffectiveDated & { userId: string | null },
>(rows: readonly T[], onDate: string): T | null {
	const covering = rows.filter((row) => coversDate(row, onDate));
	const owned = covering.filter((row) => row.userId !== null);
	const pool = owned.length > 0 ? owned : covering;

	let best: T | null = null;
	for (const row of pool) {
		if (best === null || row.effectiveFrom > best.effectiveFrom) best = row;
	}
	return best;
}
