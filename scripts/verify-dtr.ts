/**
 * End-to-end check of the DTR write path against a real database.
 *
 * Unit tests cover the engine, but they cannot catch SQL-level faults: column
 * naming under `casing: "snake_case"`, constraint behaviour, cascade deletes, or
 * whether a night shift survives a round trip. Run with `npm run verify:dtr`.
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
const { userProfiles, workScheduleDays } = await import("#/db/schema/index.ts");
const { and, eq } = await import("drizzle-orm");
const {
  ensureUserBootstrap, findEmploymentTerms, findSchedules, updateScheduleRestDays,
  toPunchPolicy, toScheduleSnapshot,
} = await import("#/db/repo/profile.ts");
const { findRecordsInRange, upsertRecords } = await import("#/db/repo/dtr.ts");
const { computeDailyMinutes } = await import("#/lib/payroll/daily.ts");
const { resolveEffective } = await import("#/lib/payroll/effective.ts");
const { sumTotals } = await import("#/lib/payroll/totals.ts");
const t = await import("#/lib/payroll/time.ts");

const USER = "user_e2e_probe";
const today = t.assertIsoDate("2026-08-31");
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  cond ? pass++ : fail++;
};

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));
await ensureUserBootstrap(USER, { email: "probe@example.com" });
await ensureUserBootstrap(USER); // idempotent

const terms = await findEmploymentTerms(USER);
const schedules = await findSchedules(USER);
check("bootstrap is idempotent", terms.length === 1 && schedules.length === 1,
  `${terms.length} terms, ${schedules.length} schedules`);
check("default schedule has 7 weekdays", schedules[0].days.length === 7);

/* --- the work schedule always keeps all seven weekday rows --------------
 * A schedule that lost its day rows used to be unrecoverable: rest days could
 * not be saved, so the factor-vs-schedule warning could never be cleared. */
await db
  .delete(workScheduleDays)
  .where(and(eq(workScheduleDays.userId, USER),
             eq(workScheduleDays.scheduleId, schedules[0].id)));
check("weekday rows can be lost", (await findSchedules(USER))[0].days.length === 0);

await ensureUserBootstrap(USER);
check(
  "bootstrap heals a schedule with no weekday rows",
  (await findSchedules(USER))[0].days.length === 7,
  `${(await findSchedules(USER))[0].days.length} rows`,
);

// Sunday-only rest: six workdays a week, which is what factor 313 assumes.
await updateScheduleRestDays(USER, schedules[0].id, [0]);
const sundayOnly = (await findSchedules(USER))[0].days;
const restWeekdays = sundayOnly.filter((d) => d.isRestDay).map((d) => d.weekday);
check("rest days save even from an empty set", sundayOnly.length === 7 && restWeekdays.length === 1,
  `${sundayOnly.length} rows, rest=[${restWeekdays}]`);
check("the rest day is Sunday", restWeekdays[0] === 0, `weekday ${restWeekdays[0]}`);
check("six workdays a week implies factor 313", 365 - restWeekdays.length * 52 === 313);

// Put the fixture back to Mon-Fri for the rest of this script.
await updateScheduleRestDays(USER, schedules[0].id, [0, 6]);

const first = t.cutoffBounds(2026, 8, 1);
const second = t.cutoffBounds(2026, 8, 2);
check("Aug cutoffs are 16 and 15 days", first.dayCount === 16 && second.dayCount === 15,
  `${first.dayCount}/${second.dayCount}`);

const policy = toPunchPolicy(resolveEffective(terms, today)!);
const sched = resolveEffective(schedules, today)!;
const snapFor = (d: string) => toScheduleSnapshot(sched, sched.days.find(x => x.weekday === t.dayOfWeek(t.assertIsoDate(d))));

// Fill Aug 1-16 workdays from schedule, with three deliberate exceptions.
const rows = [];
for (const date of t.eachDate(first.start, first.end)) {
  const s = snapFor(date);
  if (!s || s.isRestDay) continue;
  let punches = { amIn: s.amIn, amOut: s.amOut, pmIn: s.pmIn, pmOut: s.pmOut };
  let status: any = "present";
  if (date === "2026-08-03") punches = { ...punches, amIn: 482 };            // 2 min late
  if (date === "2026-08-05") punches = { ...punches, pmOut: 1140 };          // 2h OT
  if (date === "2026-08-07") { punches = { amIn: null, amOut: null, pmIn: null, pmOut: null }; status = "absent"; }
  const { punches: norm, minutes } = computeDailyMinutes({
    date: t.assertIsoDate(date), today, punches, schedule: s,
    dayKind: "regular_workday", status, isRestDay: false, leave: null,
    policy, approvedOvertimeMinutes: date === "2026-08-05" ? 120 : null,
  });
  rows.push({
    userId: USER, workDate: date, amInMinute: norm.amIn, amOutMinute: norm.amOut,
    pmInMinute: norm.pmIn, pmOutMinute: norm.pmOut, dayKind: "regular_workday" as const,
    status, isRestDay: false, scheduleId: s.scheduleId, scheduleSnapshot: s,
    workedMinutes: minutes.workedMinutes, creditedRegularMinutes: minutes.creditedRegularMinutes,
    lateMinutes: minutes.lateMinutes, undertimeMinutes: minutes.undertimeMinutes,
    overtimeMinutes: minutes.overtimeMinutes,
    approvedOvertimeMinutes: date === "2026-08-05" ? 120 : null,
    nightDiffMinutes: minutes.nightDiffMinutes, nightDiffOvertimeMinutes: minutes.nightDiffOvertimeMinutes,
    paidLeaveMinutes: minutes.paidLeaveMinutes, unpaidMinutes: minutes.unpaidMinutes,
    flags: minutes.flags, remarks: null, computedAt: new Date(),
  });
}

const saved = await upsertRecords(USER, rows as any);
check("saved all workdays in cutoff 1", saved.saved.length === rows.length, `${saved.saved.length}/${rows.length}`);

// Re-save (idempotent upsert)
const again = await upsertRecords(USER, rows as any);
check("re-saving updates rather than duplicating", again.saved.length === rows.length);

const persisted = await findRecordsInRange(USER, first.start, first.end);
check("row count stable after re-save", persisted.length === rows.length, `${persisted.length} rows`);

const totals = sumTotals(persisted.map(r => ({ minutes: {
  workedMinutes: r.workedMinutes, creditedRegularMinutes: r.creditedRegularMinutes,
  lateMinutes: r.lateMinutes, undertimeMinutes: r.undertimeMinutes,
  overtimeMinutes: r.overtimeMinutes, nightDiffMinutes: r.nightDiffMinutes,
  nightDiffOvertimeMinutes: r.nightDiffOvertimeMinutes, paidLeaveMinutes: r.paidLeaveMinutes,
  unpaidMinutes: r.unpaidMinutes, flags: r.flags as any,
}, hasRecord: true })));

console.log("\n  totals:", JSON.stringify(totals));
check("late is exactly the 2 minutes entered", totals.lateMinutes === 2, `${totals.lateMinutes}`);
check("overtime is the 120 approved minutes", totals.overtimeMinutes === 120, `${totals.overtimeMinutes}`);
check("absence deducts one standard day", totals.unpaidMinutes === 480, `${totals.unpaidMinutes}`);

// Hand computation, stated explicitly so a wrong expectation is obvious:
//   7 untouched workdays  7 x 480 = 3360
//   Aug 3, in at 08:02    478  (arriving 2 min late is also 2 min less worked)
//   Aug 5, out at 19:00   600  (480 + 120 overtime)
//   Aug 7, absent           0
const expectedWorked = 7 * 480 + 478 + 600 + 0;
check("worked minutes match hand computation", totals.workedMinutes === expectedWorked,
  `${totals.workedMinutes} vs ${expectedWorked}`);

// Night shift persists with the crossing resolved
const ns = computeDailyMinutes({
  date: t.assertIsoDate("2026-08-17"), today,
  punches: { amIn: null, amOut: null, pmIn: 1320, pmOut: 90 },
  schedule: null, dayKind: "regular_workday", status: "present", isRestDay: false,
  leave: null, policy: { ...policy, overtimeRequiresApproval: false }, approvedOvertimeMinutes: null,
});
await upsertRecords(USER, [{
  userId: USER, workDate: "2026-08-17", amInMinute: null, amOutMinute: null,
  pmInMinute: ns.punches.pmIn, pmOutMinute: ns.punches.pmOut, dayKind: "regular_workday",
  status: "present", isRestDay: false, workedMinutes: ns.minutes.workedMinutes,
  flags: ns.minutes.flags, computedAt: new Date(),
} as any]);
const night = (await findRecordsInRange(USER, "2026-08-17", "2026-08-17"))[0];
check("night shift stored as 1530, not moved to the next date",
  night.pmOutMinute === 1530 && night.workDate === "2026-08-17",
  `pmOut=${night.pmOutMinute} on ${night.workDate}`);

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));
const after = await findRecordsInRange(USER, first.start, second.end);
check("cascade delete removes time records", after.length === 0);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
