/**
 * End-to-end check of the dashboard aggregation against a real database.
 *
 * Exercises the same `buildDashboard` the server function calls, so it cannot
 * drift from the real path. Run with `npm run verify:dashboard`.
 *
 * Writes and then removes a throwaway user, so it is safe against a dev database.
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
const { updateEmploymentTerms } = await import("#/db/repo/payroll.ts");
const { upsertRecords } = await import("#/db/repo/dtr.ts");
type TimeRecordInsert = Parameters<
	Awaited<typeof import("#/db/repo/dtr.ts")>["upsertRecords"]
>[1][number];
const { computeDailyMinutes } = await import("#/lib/payroll/daily.ts");
const { buildDashboard } = await import("#/server/core/dashboard.ts");
const { DEFAULT_PUNCH_POLICY } = await import("#/lib/payroll/types.ts");
const t = await import("#/lib/payroll/time.ts");

const USER = "user_dashboard_probe";
let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, extra = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
	cond ? pass++ : fail++;
};

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));
await ensureUserBootstrap(USER, { email: "dash@example.com" });
const terms = await findEmploymentTerms(USER);
await updateEmploymentTerms(USER, terms[0].id, {
	monthlyRateCentavos: 4_500_000,
	workingDaysFactorX100: 26_100,
});

const today = t.todayInManila();
const current = t.cutoffForDate(today);
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

/* Fill elapsed workdays of the current cutoff, leaving one deliberate gap and
   one day with a missing clock-out. */
const elapsed = t
	.eachDate(current.start, current.end)
	.filter((d) => d <= today)
	.filter((d) => {
		const w = t.dayOfWeek(d);
		return w !== 0 && w !== 6;
	});

/*
 * The dashboard always reports on the *live* cutoff, so how much can be checked
 * depends on how far into it today is. On the 17th there is a single elapsed
 * workday; asserting three would fail for a reason that has nothing to do with
 * the code. Scale the checks to what the calendar actually allows.
 */
const canTestGap = elapsed.length >= 2;
console.log(
	`  cutoff ${current.start}..${current.end}, ${elapsed.length} elapsed workday(s)` +
		(canTestGap ? "" : " — too early in the cutoff to test a gap; those checks are skipped"),
);
check("the current cutoff has at least one elapsed workday", elapsed.length >= 1, `${elapsed.length}`);

const gapDate = canTestGap ? elapsed[0] : null;
const missingOutDate = canTestGap ? elapsed[1] : elapsed[0];
const rows: TimeRecordInsert[] = [];

for (const date of elapsed) {
	if (gapDate && date === gapDate) continue; // deliberately left with no record at all
	// Every arrival is 08:02, so the mean arrival delta is exactly 2 minutes no
	// matter how the elapsed days fall across ISO week boundaries. One day is
	// missing its clock-out, which is a separate axis from arrival time.
	const punches =
		date === missingOutDate
			? { amIn: 482, amOut: 720, pmIn: 780, pmOut: null }
			: { amIn: 482, amOut: 720, pmIn: 780, pmOut: 1020 };
	const computed = computeDailyMinutes({
		date,
		today,
		punches,
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
		amInMinute: computed.punches.amIn,
		amOutMinute: computed.punches.amOut,
		pmInMinute: computed.punches.pmIn,
		pmOutMinute: computed.punches.pmOut,
		dayKind: "regular_workday",
		status: "present",
		isRestDay: false,
		scheduleSnapshot: schedule,
		workedMinutes: computed.minutes.workedMinutes,
		creditedRegularMinutes: computed.minutes.creditedRegularMinutes,
		lateMinutes: computed.minutes.lateMinutes,
		undertimeMinutes: computed.minutes.undertimeMinutes,
		overtimeMinutes: computed.minutes.overtimeMinutes,
		paidLeaveMinutes: computed.minutes.paidLeaveMinutes,
		unpaidMinutes: computed.minutes.unpaidMinutes,
		flags: computed.minutes.flags,
		computedAt: new Date(),
	});
}
await upsertRecords(USER, rows);

const dash = await buildDashboard(USER);

check("dashboard reports today in Manila", dash.today === today, dash.today);
check(
	"current period key matches the cutoff for today",
	dash.currentPeriodKey === current.periodKey,
	`${dash.currentPeriodKey} vs ${current.periodKey}`,
);

const expectedLate = rows.filter((r) => r.lateMinutes === 2).length * 2;
check(
	"late minutes aggregate from the stored records",
	dash.kpis.periodLateMinutes === expectedLate,
	`${dash.kpis.periodLateMinutes} vs ${expectedLate}`,
);

const expectedWorked = rows.reduce(
	(sum, r) => sum + (r.workedMinutes as number),
	0,
);
check(
	"worked minutes aggregate from the stored records",
	dash.kpis.periodWorkedMinutes === expectedWorked,
	`${dash.kpis.periodWorkedMinutes} vs ${expectedWorked}`,
);

check("six pay periods are charted", dash.periods.length === 6, `${dash.periods.length}`);
check(
	"the last charted period is the current one",
	dash.periods.at(-1)?.periodKey === current.periodKey,
);
check(
	"periods run oldest to newest",
	dash.periods.every(
		(p, i) => i === 0 || dash.periods[i - 1].periodKey <= p.periodKey,
	),
);

check("weekly series is produced", dash.weeks.length > 0, `${dash.weeks.length} weeks`);
if (rows.some((r) => r.lateMinutes === 2)) {
	// Punctuality is the *mean* arrival delta for the week, not a sum, so with
	// every fixture arrival 2 minutes late every non-empty week must read 2.
	check(
		"punctuality is the mean arrival delta, 2 minutes late",
		dash.weeks.some((w) => w.punctualityMinutes !== null) &&
			dash.weeks.every(
				(w) => w.punctualityMinutes === null || w.punctualityMinutes === 2,
			),
		JSON.stringify(dash.weeks.map((w) => w.punctualityMinutes)),
	);
}

const codes = dash.anomalies.map((a) => a.code);
check("the missing clock-out is reported", codes.includes("MISSING_TIME_OUT"), codes.join(","));
if (canTestGap && gapDate) {
	check(
		"the untouched workday is reported as a gap",
		codes.includes("NO_RECORD_ON_SCHEDULED_DAY"),
		codes.join(","),
	);
	check(
		"the gap names the right date",
		dash.anomalies
			.find((a) => a.code === "NO_RECORD_ON_SCHEDULED_DAY")
			?.dates.includes(gapDate) === true,
		gapDate,
	);
}
check(
	"every anomaly carries a message usable without AI",
	dash.anomalies.every((a) => a.defaultMessage.length > 10),
);
const rank = { critical: 0, warning: 1, info: 2 } as const;
check(
	"anomalies are ordered most serious first",
	dash.anomalies.every(
		(a, i) => i === 0 || rank[dash.anomalies[i - 1].severity] <= rank[a.severity],
	),
	dash.anomalies.map((a) => a.severity).join(",") || "none",
);

check("no payslips finalized, so year-to-date is zero", dash.kpis.ytdGrossCentavos === 0);
check("rate is configured", dash.isConfigured === true);

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
