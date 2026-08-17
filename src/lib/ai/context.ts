import { findEmploymentTerms } from "#/db/repo/profile.ts";
import { resolveEffective } from "#/lib/payroll/effective.ts";
import { formatPeso } from "#/lib/payroll/money.ts";
import { deriveRateBasis } from "#/lib/payroll/rates.ts";
import {
	type CutoffBounds,
	cutoffForDate,
	type IsoDate,
	nextCutoff,
	previousCutoff,
	todayInManila,
} from "#/lib/payroll/time.ts";

/**
 * Identity and situation handed to every assistant tool.
 *
 * `userId` originates from the Clerk session on the server and is threaded
 * through `chat({ context })`. It is never a tool argument, so the model has no
 * way to express "whose data" — and because `ToolExecuteFunction` types the
 * context parameter as required when it is not `undefined`, TypeScript refuses
 * to compile a `chat()` call that omits it. The scoping is enforced by the type
 * checker rather than by remembering to pass it.
 */
export interface AssistantContext {
	readonly userId: string;
	readonly todayManila: IsoDate;
	readonly currentPeriod: CutoffBounds;
	readonly previousPeriod: CutoffBounds;
	readonly employment: {
		monthlyRatePhp: string;
		dailyRatePhp: string;
		hourlyRatePhp: string;
		workingDaysFactor: number;
		standardHoursPerDay: number;
		isConfigured: boolean;
	};
}

export async function resolveAssistantContext(
	userId: string,
): Promise<AssistantContext> {
	const todayManila = todayInManila();
	const currentPeriod = cutoffForDate(todayManila);

	const terms = await findEmploymentTerms(userId);
	const active = resolveEffective(terms, todayManila);
	const rates = deriveRateBasis({
		monthlyRateCentavos: active?.monthlyRateCentavos ?? 0,
		workingDaysFactorX100: active?.workingDaysFactorX100 ?? 31_300,
		dailyHours: active?.dailyHours ?? 8,
		rateRoundingMode: active?.rateRoundingMode ?? "amounts_only",
	});

	return {
		userId,
		todayManila,
		currentPeriod,
		previousPeriod: previousCutoff(currentPeriod),
		employment: {
			monthlyRatePhp: formatPeso(rates.monthlyCentavos),
			dailyRatePhp: formatPeso(rates.dailyCentavos),
			hourlyRatePhp: formatPeso(rates.hourlyCentavos),
			workingDaysFactor: rates.workingDaysFactorX100 / 100,
			standardHoursPerDay: rates.dailyHours,
			isConfigured: (active?.monthlyRateCentavos ?? 0) > 0,
		},
	};
}

export { nextCutoff };
