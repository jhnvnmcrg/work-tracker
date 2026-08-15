/**
 * Re-exports so `src/schemas/` depends on the payroll vocabulary through one
 * hop, keeping the zod schemas free of deep imports into the engine.
 */
export { MINUTES_PER_DAY } from "#/lib/payroll/time.ts";
export {
	ATTENDANCE_STATUSES,
	DAY_KINDS,
	LEAVE_DAY_PORTIONS,
} from "#/lib/payroll/types.ts";
