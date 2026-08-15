import { timestamp } from "drizzle-orm/pg-core";

/**
 * Audit instants — and the only place `timestamptz` is used.
 *
 * Business dates and clock times are stored as local wall-clock values (a `date`
 * string plus integer minutes since midnight). These two columns record when a
 * row was touched, which is a genuine instant, so they are timezone-aware.
 */
export const auditCols = {
	createdAt: timestamp({ withTimezone: true, mode: "date" })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp({ withTimezone: true, mode: "date" })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
};
