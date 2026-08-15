import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditCols } from "./_shared.ts";
import * as e from "./enums.ts";
import { userProfiles } from "./identity.ts";

/** `userId IS NULL` is a seeded global template, copied per user at bootstrap. */
export const leaveTypes = pgTable(
	"leave_types",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().references(() => userProfiles.userId, {
			onDelete: "cascade",
		}),
		code: text().notNull(),
		name: text().notNull(),
		isPaid: boolean().notNull().default(true),
		accrualMode: e.leaveAccrualMode().notNull().default("none"),
		/**
		 * Minutes rather than days: 1.25 days/month at 8h is exactly 600, which
		 * stays integral and composes directly with the DTR engine.
		 */
		accrualMinutesPerPeriod: integer().notNull().default(0),
		maxBalanceMinutes: integer(),
		maxCarryOverMinutes: integer(),
		allowsHalfDay: boolean().notNull().default(true),
		requiresDocument: boolean().notNull().default(false),
		isConvertible: boolean().notNull().default(false),
		colorHex: text(),
		sortOrder: smallint().notNull().default(0),
		isActive: boolean().notNull().default(true),
		...auditCols,
	},
	(t) => [
		uniqueIndex("leave_types_user_code_uq")
			.on(t.userId, t.code)
			.where(sql`${t.userId} IS NOT NULL`),
		uniqueIndex("leave_types_global_code_uq")
			.on(t.code)
			.where(sql`${t.userId} IS NULL`),
	],
);

export const leaveRequests = pgTable(
	"leave_requests",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		leaveTypeId: integer()
			.notNull()
			.references(() => leaveTypes.id, { onDelete: "restrict" }),
		startDate: date({ mode: "string" }).notNull(),
		endDate: date({ mode: "string" }).notNull(),
		totalMinutes: integer().notNull().default(0),
		status: e.leaveRequestStatus().notNull().default("draft"),
		reason: text(),
		filedAt: timestamp({ withTimezone: true, mode: "date" }),
		decidedAt: timestamp({ withTimezone: true, mode: "date" }),
		decisionNote: text(),
		...auditCols,
	},
	(t) => [
		// Table constraint, not an index — see the note in identity.ts.
		unique("leave_requests_user_id_uq").on(t.userId, t.id),
		index("leave_requests_user_range_idx").on(t.userId, t.startDate, t.endDate),
		index("leave_requests_user_status_idx").on(t.userId, t.status),
		check("leave_requests_range_ck", sql`${t.endDate} >= ${t.startDate}`),
	],
);

/**
 * Per-day expansion of a request — what the DTR engine joins against.
 *
 * `portion` is load-bearing: a bare minute count cannot tell the engine whether
 * to forgive morning lateness or afternoon lateness on a half-day.
 */
export const leaveRequestDays = pgTable(
	"leave_request_days",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().notNull(),
		requestId: integer().notNull(),
		leaveDate: date({ mode: "string" }).notNull(),
		portion: e.leaveDayPortion().notNull().default("full"),
		minutes: smallint().notNull(),
		/** Only meaningful when `portion` is 'custom'. */
		startMinute: smallint(),
		endMinute: smallint(),
		isPaid: boolean().notNull().default(true),
	},
	(t) => [
		uniqueIndex("leave_request_days_uq").on(t.requestId, t.leaveDate),
		index("leave_request_days_user_date_idx").on(t.userId, t.leaveDate),
		foreignKey({
			columns: [t.userId, t.requestId],
			foreignColumns: [leaveRequests.userId, leaveRequests.id],
			name: "leave_request_days_request_fk",
		}).onDelete("cascade"),
	],
);

/**
 * Append-only ledger — the source of truth for leave balances.
 *
 * There is deliberately no `leave_balances` table. A cached balance drifts the
 * moment a request is edited or a payslip voided, and reconciling it is a
 * recurring bug factory; `SUM(delta_minutes)` is always correct and is free at
 * personal scale. If it ever gets slow, add a materialized view.
 */
export const leaveLedger = pgTable(
	"leave_ledger",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		leaveTypeId: integer()
			.notNull()
			.references(() => leaveTypes.id, { onDelete: "restrict" }),
		entryDate: date({ mode: "string" }).notNull(),
		creditYear: smallint().notNull(),
		/** Positive grants credit, negative consumes it. */
		deltaMinutes: integer().notNull(),
		source: e.leaveLedgerSource().notNull(),
		sourceRequestId: integer().references(() => leaveRequests.id, {
			onDelete: "set null",
		}),
		note: text(),
		createdAt: auditCols.createdAt,
	},
	(t) => [
		index("leave_ledger_balance_idx").on(t.userId, t.leaveTypeId, t.creditYear),
		index("leave_ledger_user_date_idx").on(t.userId, t.entryDate.desc()),
		// One usage entry per request, so re-filing cannot double-debit.
		uniqueIndex("leave_ledger_usage_uq")
			.on(t.sourceRequestId)
			.where(sql`${t.source} = 'usage'`),
	],
);
