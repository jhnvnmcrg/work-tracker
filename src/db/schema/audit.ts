import { bigint, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { auditCols } from "./_shared.ts";
import * as e from "./enums.ts";
import { userProfiles } from "./identity.ts";

/**
 * One generic audit table rather than per-entity logs.
 *
 * `entityType` is plain `text` precisely so adding a new auditable entity never
 * requires a migration or an `ALTER TYPE`.
 */
export const auditLog = pgTable(
	"audit_log",
	{
		id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		/** Differs from `userId` only if impersonation is ever added. */
		actorUserId: text().notNull(),
		entityType: text().notNull(),
		entityId: text().notNull(),
		action: e.auditAction().notNull(),
		changedFields: text().array(),
		before: jsonb(),
		after: jsonb(),
		reason: text(),
		requestId: text(),
		ipAddress: text(),
		userAgent: text(),
		createdAt: auditCols.createdAt,
	},
	(t) => [
		index("audit_log_entity_idx").on(
			t.userId,
			t.entityType,
			t.entityId,
			t.createdAt.desc(),
		),
		index("audit_log_user_time_idx").on(t.userId, t.createdAt.desc()),
		index("audit_log_action_idx").on(t.userId, t.action, t.createdAt.desc()),
	],
);
