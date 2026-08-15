/**
 * Integer money primitives.
 *
 * Everything monetary in this system is an integer. Centavos for amounts,
 * micro-centavos for intermediate rates, parts-per-million for multipliers.
 * There are no floats and no `numeric` strings in any calculation.
 *
 * The reason is the shape of the pipeline: a monthly rate is divided by two,
 * multiplied by 1200, divided by a working-days factor, divided by eight, divided
 * by sixty, multiplied by a minute count, then multiplied by a premium. Six
 * chained operations where float error compounds, and where "exactly where did we
 * round" is what decides whether the payslip reconciles with an employer's system
 * to the centavo. Integers make every value exact and make rounding a single,
 * explicitly-called, unit-tested function.
 *
 * The type aliases below are documentation rather than branded types. The
 * discipline that actually prevents unit confusion is naming — every value and
 * every column carries its unit in its name (`monthlyRateCentavos`,
 * `minuteMicroCentavos`, `excessRatePpm`) — backed by the test suite. Branding
 * would add casts at every database boundary for a risk the naming already
 * covers.
 */

/** Integer centavos. 100 centavos = 1 peso. */
export type Centavos = number;

/** Centavos x 1,000,000. Used for rates so nothing rounds mid-pipeline. */
export type MicroCentavos = number;

/** Parts per million. 5% is 50_000; a 1.25x multiplier is 1_250_000. */
export type Ppm = number;

export const PPM_ONE = 1_000_000;
export const MICROS_PER_CENTAVO = 1_000_000;
export const CENTAVOS_PER_PESO = 100;

/**
 * `round(value * numerator / denominator)`, half away from zero.
 *
 * The single most important function in the codebase: every peso passes through
 * it. BigInt is used internally because the intermediate genuinely overflows a
 * JS number — deriving a daily rate is `monthlyCentavos * 1200 * 1e6 / factor`,
 * and for a ₱1,000,000 monthly rate that product is 1.2e17, well past
 * `Number.MAX_SAFE_INTEGER` at 9.007e15.
 *
 * Half away from zero, not `Math.round`, which rounds -2.5 to -2 and so would
 * treat a deduction and an earning of the same size differently.
 */
export function mulDivRound(
	value: number,
	numerator: number,
	denominator: number,
): number {
	if (denominator === 0) {
		throw new Error("mulDivRound: denominator must not be zero");
	}
	if (!Number.isInteger(value) || !Number.isInteger(numerator)) {
		throw new Error(
			`mulDivRound expects integers, received ${value} and ${numerator}`,
		);
	}

	const product = BigInt(value) * BigInt(numerator);
	const divisor = BigInt(denominator);

	const negative = product < 0n !== divisor < 0n;
	const absProduct = product < 0n ? -product : product;
	const absDivisor = divisor < 0n ? -divisor : divisor;

	const quotient = absProduct / absDivisor;
	const remainder = absProduct % absDivisor;
	// Round up when the remainder is at least half the divisor.
	const rounded = remainder * 2n >= absDivisor ? quotient + 1n : quotient;

	const result = negative ? -rounded : rounded;
	if (
		result > BigInt(Number.MAX_SAFE_INTEGER) ||
		result < BigInt(Number.MIN_SAFE_INTEGER)
	) {
		throw new Error(`mulDivRound: result ${result} exceeds safe integer range`);
	}
	return Number(result);
}

/** Applies a parts-per-million rate to an integer amount. */
export function applyPpm(value: number, ppm: Ppm): number {
	return mulDivRound(value, ppm, PPM_ONE);
}

export function microsToCentavos(micros: MicroCentavos): Centavos {
	return mulDivRound(micros, 1, MICROS_PER_CENTAVO);
}

export function centavosToMicros(centavos: Centavos): MicroCentavos {
	return centavos * MICROS_PER_CENTAVO;
}

export function sumCentavos(values: readonly Centavos[]): Centavos {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

export function clampAtZero(value: number): number {
	return value < 0 ? 0 : value;
}

/**
 * Splits a total into `parts` that sum to it exactly.
 *
 * Every part gets the truncated quotient and the last absorbs the remainder, so
 * `sum(split(total, n)) === total` for every input. This is what guarantees two
 * semi-monthly base amounts add up to the monthly rate, and what keeps a
 * contribution split across cutoffs from gaining or losing a centavo.
 */
export function splitCentavosExact(total: Centavos, parts: number): Centavos[] {
	if (!Number.isInteger(parts) || parts < 1) {
		throw new Error(
			`splitCentavosExact: parts must be >= 1, received ${parts}`,
		);
	}
	const quotient = Math.trunc(total / parts);
	const result = new Array<number>(parts).fill(quotient);
	result[parts - 1] = total - quotient * (parts - 1);
	return result;
}

/**
 * Reads a value that may have arrived from Postgres as a string.
 *
 * `SUM(bigint)` returns `numeric`, which node-postgres delivers as a string.
 * Every aggregate has to come through here or it silently becomes string
 * concatenation.
 */
export function parseCentavos(
	value: string | number | null | undefined,
): Centavos {
	if (value === null || value === undefined) return 0;
	if (typeof value === "number") {
		if (!Number.isInteger(value)) {
			throw new Error(`parseCentavos: expected an integer, received ${value}`);
		}
		return value;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
		throw new Error(`parseCentavos: cannot read "${value}" as centavos`);
	}
	return parsed;
}

/** Parses user input in pesos ("45,000.50") into centavos. */
export function pesosToCentavos(input: string | number): Centavos {
	const text = String(input)
		.replace(/[,\s₱]/g, "")
		.trim();
	if (text === "") return 0;
	if (!/^-?\d*(\.\d{0,2})?$/.test(text)) {
		throw new Error(`pesosToCentavos: cannot read "${input}" as an amount`);
	}
	const negative = text.startsWith("-");
	const [whole, fraction = ""] = text.replace("-", "").split(".");
	const centavos =
		Number(whole || "0") * CENTAVOS_PER_PESO + Number(fraction.padEnd(2, "0"));
	return negative ? -centavos : centavos;
}

const PESO_FORMAT = new Intl.NumberFormat("en-PH", {
	style: "currency",
	currency: "PHP",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/** "₱25,000.00". Formatting happens once, at the display boundary. */
export function formatPeso(centavos: Centavos): string {
	return PESO_FORMAT.format(centavos / CENTAVOS_PER_PESO);
}

/** "25000.00" — for inputs and exports, without the symbol or separators. */
export function toPesoString(centavos: Centavos): string {
	const negative = centavos < 0;
	const abs = Math.abs(centavos);
	const whole = Math.floor(abs / CENTAVOS_PER_PESO);
	const fraction = String(abs % CENTAVOS_PER_PESO).padStart(2, "0");
	return `${negative ? "-" : ""}${whole}.${fraction}`;
}
