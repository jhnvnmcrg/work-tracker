import { sql } from "drizzle-orm";
import {
	boolean,
	date,
	index,
	integer,
	pgTable,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditCols } from "./_shared.ts";
import * as e from "./enums.ts";
import { userProfiles } from "./identity.ts";

/**
 * Holiday calendar.
 *
 * `userId IS NULL` marks a seeded global holiday, read-only from the app. A
 * non-null `userId` is the user's own addition or override, which wins for its
 * date. There is deliberately no "recurs annually" flag: Philippine holidays are
 * proclaimed each year and several movable ones (Eid, Chinese New Year, National
 * Heroes Day) genuinely change date, so a recurrence rule would be right for
 * roughly half of them and silently wrong for the rest. Seed per calendar year.
 */
export const holidays = pgTable(
	"holidays",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().references(() => userProfiles.userId, {
			onDelete: "cascade",
		}),
		holidayDate: date({ mode: "string" }).notNull(),
		name: text().notNull(),
		kind: e.holidayKind().notNull(),
		scope: e.holidayScope().notNull().default("national"),
		/** Applies only when the user's `employmentTerms.holidayRegions` includes it. */
		region: text(),
		isHalfDay: boolean().notNull().default(false),
		proclamationRef: text(),
		sourceUrl: text(),
		notes: text(),
		...auditCols,
	},
	(t) => [
		uniqueIndex("holidays_global_uq")
			.on(t.holidayDate, t.name)
			.where(sql`${t.userId} IS NULL`),
		uniqueIndex("holidays_user_uq")
			.on(t.userId, t.holidayDate, t.name)
			.where(sql`${t.userId} IS NOT NULL`),
		index("holidays_date_idx").on(t.holidayDate),
		index("holidays_user_date_idx").on(t.userId, t.holidayDate),
	],
);
