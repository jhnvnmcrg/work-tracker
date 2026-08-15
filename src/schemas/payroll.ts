import { z } from "zod";
import {
	DEDUCTION_TIMINGS,
	STATUTORY_KINDS,
	TAX_PERIOD_TYPES,
} from "#/lib/payroll/types.ts";
import { dateKeySchema } from "./dtr.ts";

const centavos = z.number().int().min(0).nullable();
/** Parts per million: 5% is 50_000. */
const ppm = z.number().int().min(0).max(100_000_000).nullable();

export const bracketInput = z.object({
	periodType: z.enum(TAX_PERIOD_TYPES).default("monthly"),
	rangeFromCentavos: z.number().int().min(0),
	rangeToCentavos: centavos,
	salaryCreditCentavos: centavos,
	employeeAmountCentavos: centavos,
	employerAmountCentavos: centavos,
	employerEcAmountCentavos: centavos,
	employeeMpfCentavos: centavos,
	employerMpfCentavos: centavos,
	employeeRatePpm: ppm,
	employerRatePpm: ppm,
	capCentavos: centavos,
	baseAmountCentavos: centavos,
	excessRatePpm: ppm,
});

export const saveScheduleInput = z
	.object({
		id: z.number().int().positive().optional(),
		kind: z.enum(STATUTORY_KINDS),
		name: z.string().min(1).max(120),
		effectiveFrom: dateKeySchema,
		effectiveTo: dateKeySchema.nullable().default(null),
		ratePpm: ppm,
		employeeSharePpm: ppm,
		floorCentavos: centavos,
		ceilingCentavos: centavos,
		/**
		 * Required, not optional. Nobody can verify these numbers from memory, so
		 * every table has to point at the issuance it came from.
		 */
		sourceCitation: z.string().min(1).max(300),
		verifiedAt: dateKeySchema.nullable().default(null),
		brackets: z.array(bracketInput).max(200).default([]),
	})
	.refine(
		(value) =>
			value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom,
		{
			message: "The end date cannot be before the start date",
			path: ["effectiveTo"],
		},
	);

export const deleteScheduleInput = z.object({
	id: z.number().int().positive(),
});

export const updateTermsInput = z.object({
	monthlyRateCentavos: z.number().int().min(0).max(1_000_000_000),
	/** Divisor x 100: 313 is 31300. */
	workingDaysFactorX100: z.number().int().min(100).max(40_000),
	dailyHours: z.number().int().min(1).max(24),
	graceMinutes: z.number().int().min(0).max(120),
	graceForfeits: z.boolean(),
	minOvertimeMinutes: z.number().int().min(0).max(480),
	overtimeRequiresApproval: z.boolean(),
	sssTiming: z.enum(DEDUCTION_TIMINGS),
	philhealthTiming: z.enum(DEDUCTION_TIMINGS),
	pagibigTiming: z.enum(DEDUCTION_TIMINGS),
	taxExempt: z.boolean(),
	restDays: z.array(z.number().int().min(0).max(6)).max(7),
});
