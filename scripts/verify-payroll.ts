/**
 * End-to-end check of the payroll write path against a real database.
 *
 * Covers what unit tests cannot: statutory tables round-tripping through
 * Postgres, payslip persistence, DTR locking on finalize, and release on void.
 * Run with `npm run verify:payroll`.
 *
 * Every contribution figure below is invented to exercise the arithmetic — the
 * app ships with these tables empty. Writes and then removes a throwaway user.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

if (!process.env.DATABASE_URL) {
	console.log("DATABASE_URL is not set — skipping.");
	process.exit(0);
}

const { db } = await import("#/db/index.ts");
const { userProfiles } = await import("#/db/schema/index.ts");
const { eq } = await import("drizzle-orm");
const { ensureUserBootstrap, findEmploymentTerms } = await import(
	"#/db/repo/profile.ts"
);
const {
	findStatutorySchedules,
	saveStatutorySchedule,
	updateEmploymentTerms,
	ensurePayPeriod,
	findPayslipByPeriod,
	persistFinalizedPayslip,
	voidPayslip,
} = await import("#/db/repo/payroll.ts");
const { findRecordsInRange, upsertRecords } = await import("#/db/repo/dtr.ts");
type TimeRecordInsert = Parameters<typeof upsertRecords>[1][number];
const { computeDailyMinutes } = await import("#/lib/payroll/daily.ts");
const { DEFAULT_PUNCH_POLICY } = await import("#/lib/payroll/types.ts");
const t = await import("#/lib/payroll/time.ts");
const { formatPeso } = await import("#/lib/payroll/money.ts");

const USER = "user_payroll_probe";
let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, extra = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
	cond ? pass++ : fail++;
};

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));
await ensureUserBootstrap(USER, { email: "payroll@example.com" });

const terms = await findEmploymentTerms(USER);
await updateEmploymentTerms(USER, terms[0].id, {
	monthlyRateCentavos: 4_500_000, // ₱45,000
	workingDaysFactorX100: 26_100, // 261, matching the Mon-Fri default schedule
	sssTiming: "first_cutoff",
	philhealthTiming: "first_cutoff",
	pagibigTiming: "first_cutoff",
});

/* --- Statutory tables round-trip ---------------------------------------- */
await saveStatutorySchedule(USER, {
	kind: "sss",
	name: "probe SSS",
	effectiveFrom: "2020-01-01",
	effectiveTo: null,
	ratePpm: null,
	employeeSharePpm: null,
	floorCentavos: null,
	ceilingCentavos: null,
	sourceCitation: "probe fixture",
	verifiedAt: "2026-01-01",
	brackets: [
		{
			periodType: "monthly",
			rangeFromCentavos: 0,
			rangeToCentavos: null,
			salaryCreditCentavos: 4_500_000,
			employeeAmountCentavos: 90_000,
			employerAmountCentavos: 180_000,
			employerEcAmountCentavos: null,
			employeeMpfCentavos: null,
			employerMpfCentavos: null,
			employeeRatePpm: null,
			employerRatePpm: null,
			capCentavos: null,
			baseAmountCentavos: null,
			excessRatePpm: null,
		},
	],
});

await saveStatutorySchedule(USER, {
	kind: "philhealth",
	name: "probe PhilHealth",
	effectiveFrom: "2020-01-01",
	effectiveTo: null,
	ratePpm: 50_000,
	employeeSharePpm: 500_000,
	floorCentavos: 1_000_000,
	ceilingCentavos: 10_000_000,
	sourceCitation: "probe fixture",
	verifiedAt: "2026-01-01",
	brackets: [],
});

const stored = await findStatutorySchedules(USER);
const sss = stored.find((s) => s.kind === "sss");
check("statutory schedule round-trips with its bracket", sss?.brackets.length === 1);
check(
	"bracket amounts survive the round trip",
	sss?.brackets[0].employeeAmountCentavos === 90_000,
	String(sss?.brackets[0].employeeAmountCentavos),
);
check(
	"citation and verified date are stored",
	sss?.sourceCitation === "probe fixture" && sss?.verifiedAt === "2026-01-01",
);

const phic = stored.find((s) => s.kind === "philhealth");
check(
	"a percentage scheme stores its rate and range",
	phic?.ratePpm === 50_000 && phic?.floorCentavos === 1_000_000,
);

/* --- Fill a cutoff, then finalize --------------------------------------- */
const bounds = t.cutoffBounds(2026, 8, 1);
const schedule = {
	scheduleId: 1,
	amIn: 480,
	amOut: 720,
	pmIn: 780,
	pmOut: 1020,
	standardWorkMinutes: 480,
	breakMinutes: 60,
	isRestDay: false,
};

const rows: TimeRecordInsert[] = [];
for (const date of t.eachDate(bounds.start, bounds.end)) {
	const weekday = t.dayOfWeek(date);
	if (weekday === 0 || weekday === 6) continue;
	const { punches, minutes } = computeDailyMinutes({
		date,
		today: t.assertIsoDate("2026-12-31"),
		punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: 1020 },
		schedule,
		dayKind: "regular_workday",
		status: "present",
		isRestDay: false,
		leave: null,
		policy: DEFAULT_PUNCH_POLICY,
		approvedOvertimeMinutes: null,
	});
	rows.push({
		userId: USER,
		workDate: date,
		amInMinute: punches.amIn,
		amOutMinute: punches.amOut,
		pmInMinute: punches.pmIn,
		pmOutMinute: punches.pmOut,
		dayKind: "regular_workday" as const,
		status: "present" as const,
		isRestDay: false,
		scheduleSnapshot: schedule,
		workedMinutes: minutes.workedMinutes,
		creditedRegularMinutes: minutes.creditedRegularMinutes,
		lateMinutes: minutes.lateMinutes,
		undertimeMinutes: minutes.undertimeMinutes,
		overtimeMinutes: minutes.overtimeMinutes,
		paidLeaveMinutes: minutes.paidLeaveMinutes,
		unpaidMinutes: minutes.unpaidMinutes,
		flags: minutes.flags,
		computedAt: new Date(),
	});
}
await upsertRecords(USER, rows);

const period = await ensurePayPeriod(USER, {
	year: 2026,
	month: 8,
	half: "first",
	startDate: bounds.start,
	endDate: bounds.end,
	payDate: bounds.end,
	dayCount: bounds.dayCount,
});
check("pay period respects the 1-16 cutoff constraint", period.dayCount === 16);

const payslip = await persistFinalizedPayslip(USER, {
	payPeriodId: period.id,
	header: {
		type: "regular",
		status: "finalized",
		monthlyRateCentavos: 4_500_000,
		workingDaysFactorX100: 26_100,
		dailyRateCentavos: 206_897,
		hourlyRateCentavos: 25_862,
		basePayCentavos: 2_250_000,
		totalEarningsCentavos: 2_250_000,
		taxableGrossCentavos: 2_047_500,
		grossPayCentavos: 2_250_000,
		totalDeductionsCentavos: 202_500,
		netPayCentavos: 2_047_500,
		sssEeCentavos: 90_000,
		philhealthEeCentavos: 112_500,
		finalizedAt: new Date(),
	},
	lines: [
		{
			section: "earnings",
			category: "base_pay",
			code: "BASIC",
			label: "Basic pay",
			amountCentavos: 2_250_000,
			sortOrder: 10,
			computation: {
				computation: "Half of the monthly rate.",
				sourceDates: [],
				ruleReference: null,
			},
		},
		{
			section: "deductions",
			category: "sss",
			code: "SSS_EE",
			label: "SSS",
			amountCentavos: 90_000,
			isStatutory: true,
			reducesTaxableGross: true,
			sortOrder: 200,
			computation: {
				computation: "Bracket lookup on monthly compensation.",
				sourceDates: [],
				ruleReference: "probe fixture",
			},
		},
	],
	lockDates: t.eachDate(bounds.start, bounds.end),
});

check("payslip persists", payslip.status === "finalized");
check(
	"the net = gross - deductions constraint holds",
	payslip.netPayCentavos === payslip.grossPayCentavos - payslip.totalDeductionsCentavos,
	formatPeso(payslip.netPayCentavos),
);

const fetched = await findPayslipByPeriod(USER, period.id);
check("payslip reads back with its lines", fetched?.lines.length === 2);
check(
	"line provenance survives the round trip",
	fetched?.lines.find((l) => l.code === "SSS_EE")?.computation?.ruleReference ===
		"probe fixture",
);
check(
	"reducesTaxableGross is stored independently of section",
	fetched?.lines.find((l) => l.code === "SSS_EE")?.reducesTaxableGross === true &&
		fetched?.lines.find((l) => l.code === "SSS_EE")?.section === "deductions",
);

/* --- Locking ------------------------------------------------------------ */
const locked = await findRecordsInRange(USER, bounds.start, bounds.end);
check(
	"finalizing locks every DTR row in the cutoff",
	locked.length > 0 && locked.every((r) => r.lockedByPayslipId === payslip.id),
	`${locked.filter((r) => r.lockedByPayslipId !== null).length}/${locked.length} locked`,
);

const attempted = await upsertRecords(USER, [
	{ ...rows[0], amInMinute: 600 },
]);
check(
	"a locked day refuses edits and reports itself",
	attempted.saved.length === 0 && attempted.skippedLocked.length === 1,
	JSON.stringify(attempted.skippedLocked),
);
const firstDate = rows[0].workDate as string;
const unchanged = await findRecordsInRange(USER, firstDate, firstDate);
check("the locked day kept its original punch", unchanged[0].amInMinute === 480);

/* --- Voiding releases the lock ------------------------------------------ */
check("voiding succeeds", await voidPayslip(USER, payslip.id, "probe"));
const released = await findRecordsInRange(USER, bounds.start, bounds.end);
check(
	"voiding releases every lock",
	released.every((r) => r.lockedByPayslipId === null),
);
const afterVoid = await upsertRecords(USER, [
	{ ...rows[0], amInMinute: 600 },
]);
check("the day is editable again", afterVoid.saved.length === 1);
check("a voided payslip no longer reads back", (await findPayslipByPeriod(USER, period.id)) === null);

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
