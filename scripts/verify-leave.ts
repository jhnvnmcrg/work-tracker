/**
 * End-to-end check of leave and holidays against a real database.
 *
 * Exercises the same `fileLeaveFor` / `cancelLeaveFor` functions the server
 * functions call, so this cannot drift from the real path. Run with
 * `npm run verify:leave`.
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
const { ensureUserBootstrap } = await import("#/db/repo/profile.ts");
const {
	ensureLeaveTypes,
	findLeaveTypes,
	findLedger,
	addLedgerEntry,
} = await import("#/db/repo/leave.ts");
const { createUserHoliday } = await import("#/db/repo/holidays.ts");
const { findRecordsInRange } = await import("#/db/repo/dtr.ts");
const { fileLeaveFor, cancelLeaveFor } = await import("#/server/leave.ts");
const { summarizeBalances } = await import("#/lib/payroll/leave.ts");

const USER = "user_leave_probe";
let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, extra = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
	cond ? pass++ : fail++;
};

const balanceDays = async (leaveTypeId: number) => {
	const ledger = await findLedger(USER);
	const balances = summarizeBalances(
		ledger.filter((e) => e.creditYear === 2026),
	);
	const found = balances.find((b) => b.leaveTypeId === leaveTypeId);
	return (found?.balanceMinutes ?? 0) / 480;
};

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));
await ensureUserBootstrap(USER, { email: "leave@example.com" });
await ensureLeaveTypes(USER);

const types = await findLeaveTypes(USER);
const vl = types.find((t) => t.code === "VL");
if (!vl) throw new Error("VL leave type missing after bootstrap");
check("bootstrap creates the default leave types", types.length === 6, `${types.length} types`);

// Grant 15 days of VL for 2026.
await addLedgerEntry(USER, {
	leaveTypeId: vl.id,
	entryDate: "2026-01-01",
	creditYear: 2026,
	deltaMinutes: 15 * 480,
	source: "opening",
	note: "opening balance",
});
check("opening balance is 15 days", (await balanceDays(vl.id)) === 15);

/* --- 1. Three plain weekdays: Mon 3 to Wed 5 August 2026 ----------------- */
const plain = await fileLeaveFor(USER, {
	leaveTypeId: vl.id,
	startDate: "2026-08-03",
	endDate: "2026-08-05",
	halfDayStart: false,
	halfDayEnd: false,
	reason: null,
});
check("filing three weekdays charges three days", plain.daysCharged === 3, `${plain.daysCharged}`);
check("balance drops by exactly three", (await balanceDays(vl.id)) === 12, `${await balanceDays(vl.id)}`);

const marked = await findRecordsInRange(USER, "2026-08-03", "2026-08-05");
check("all three DTR rows exist", marked.length === 3, `${marked.length} rows`);
check(
	"DTR rows are marked as leave",
	marked.every((r) => r.status === "on_leave"),
	marked.map((r) => r.status).join(","),
);
check(
	"leave days are paid, not deducted",
	marked.every((r) => r.paidLeaveMinutes === 480 && r.unpaidMinutes === 0),
);

/* --- 2. Range spanning a weekend: Fri 7 to Tue 11 August ----------------- */
const overWeekend = await fileLeaveFor(USER, {
	leaveTypeId: vl.id,
	startDate: "2026-08-07",
	endDate: "2026-08-11",
	halfDayStart: false,
	halfDayEnd: false,
	reason: null,
});
check("a five-day span over a weekend charges three days", overWeekend.daysCharged === 3, `${overWeekend.daysCharged}`);
check(
	"the weekend is reported as skipped",
	overWeekend.skipped.filter((s) => s.reason === "rest_day").length === 2,
	JSON.stringify(overWeekend.skipped),
);
const weekendRows = await findRecordsInRange(USER, "2026-08-08", "2026-08-09");
check("no DTR rows were written for the weekend", weekendRows.length === 0, `${weekendRows.length} rows`);
check("balance is now nine days", (await balanceDays(vl.id)) === 9, `${await balanceDays(vl.id)}`);

/* --- 3. A holiday inside the range is not charged ------------------------ */
await createUserHoliday(USER, {
	holidayDate: "2026-08-13",
	name: "Probe holiday",
	kind: "regular",
	scope: "national",
});
const overHoliday = await fileLeaveFor(USER, {
	leaveTypeId: vl.id,
	startDate: "2026-08-12",
	endDate: "2026-08-14",
	halfDayStart: false,
	halfDayEnd: false,
	reason: null,
});
check("a holiday inside the range is not charged", overHoliday.daysCharged === 2, `${overHoliday.daysCharged}`);
check(
	"the holiday is reported as skipped",
	overHoliday.skipped.some((s) => s.date === "2026-08-13" && s.reason === "holiday"),
	JSON.stringify(overHoliday.skipped),
);

/* --- 4. Overlapping request is rejected ---------------------------------- */
const overlap = await fileLeaveFor(USER, {
	leaveTypeId: vl.id,
	startDate: "2026-08-03",
	endDate: "2026-08-03",
	halfDayStart: false,
	halfDayEnd: false,
	reason: null,
});
check("a duplicate request is refused", overlap.error !== null && overlap.requestId === null, overlap.error ?? "");

/* --- 5. Weekend-only request is refused ---------------------------------- */
const weekendOnly = await fileLeaveFor(USER, {
	leaveTypeId: vl.id,
	startDate: "2026-08-22",
	endDate: "2026-08-23",
	halfDayStart: false,
	halfDayEnd: false,
	reason: null,
});
check("a weekend-only request is refused", weekendOnly.error !== null, weekendOnly.error ?? "");

/* --- 6. Half day charges half ------------------------------------------- */
const balanceBeforeHalf = await balanceDays(vl.id);
const half = await fileLeaveFor(USER, {
	leaveTypeId: vl.id,
	startDate: "2026-08-17",
	endDate: "2026-08-17",
	halfDayStart: true,
	halfDayEnd: false,
	reason: null,
});
check("a half day charges 240 minutes", half.minutesCharged === 240, `${half.minutesCharged}`);
check(
	"balance drops by half a day",
	(await balanceDays(vl.id)) === balanceBeforeHalf - 0.5,
	`${await balanceDays(vl.id)}`,
);

/* --- 7. Cancelling returns the credit and clears the DTR rows ------------ */
const beforeCancel = await balanceDays(vl.id);
const cancelled = await cancelLeaveFor(USER, plain.requestId as number);
check("cancelling reports success", cancelled.cancelled === true);
check(
	"cancelling returns exactly three days",
	(await balanceDays(vl.id)) === beforeCancel + 3,
	`${await balanceDays(vl.id)}`,
);
const afterCancel = await findRecordsInRange(USER, "2026-08-03", "2026-08-05");
check(
	"cancelled days are no longer marked as leave",
	afterCancel.every((r) => r.status !== "on_leave" && r.paidLeaveMinutes === 0),
	afterCancel.map((r) => `${r.workDate}:${r.status}`).join(","),
);

await db.delete(userProfiles).where(eq(userProfiles.userId, USER));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
