import { describe, expect, it } from "vitest";
import { computeDailyMinutes, normalizePunches } from "./daily.ts";
import { assertIsoDate } from "./time.ts";
import {
	type DailyInput,
	DEFAULT_PUNCH_POLICY,
	type LeaveContext,
	type PunchPolicy,
	type PunchSet,
	type ScheduleSnapshot,
} from "./types.ts";

const TODAY = assertIsoDate("2026-08-15");
const DATE = assertIsoDate("2026-08-03"); // a Monday

/** 08:00–12:00, 13:00–17:00 with a one-hour break. */
const SCHEDULE: ScheduleSnapshot = {
	scheduleId: 1,
	amIn: 480,
	amOut: 720,
	pmIn: 780,
	pmOut: 1020,
	standardWorkMinutes: 480,
	breakMinutes: 60,
	isRestDay: false,
};

const REST_DAY_SCHEDULE: ScheduleSnapshot = {
	...SCHEDULE,
	amIn: null,
	amOut: null,
	pmIn: null,
	pmOut: null,
	standardWorkMinutes: 0,
	isRestDay: true,
};

function punches(
	amIn: number | null,
	amOut: number | null,
	pmIn: number | null,
	pmOut: number | null,
): PunchSet {
	return { amIn, amOut, pmIn, pmOut };
}

function run(overrides: Partial<DailyInput> = {}) {
	const input: DailyInput = {
		date: DATE,
		today: TODAY,
		punches: punches(480, 720, 780, 1020),
		schedule: SCHEDULE,
		dayKind: "regular_workday",
		status: "present",
		isRestDay: false,
		leave: null,
		policy: DEFAULT_PUNCH_POLICY,
		approvedOvertimeMinutes: null,
		...overrides,
	};
	return computeDailyMinutes(input);
}

const policy = (over: Partial<PunchPolicy>): PunchPolicy => ({
	...DEFAULT_PUNCH_POLICY,
	...over,
});

/* -------------------------------------------------------------------------- */

describe("a plain day", () => {
	it("credits the full standard day with nothing owed", () => {
		const { minutes } = run();
		expect(minutes).toMatchObject({
			workedMinutes: 480,
			creditedRegularMinutes: 480,
			lateMinutes: 0,
			undertimeMinutes: 0,
			overtimeMinutes: 0,
			unpaidMinutes: 0,
		});
		expect(minutes.flags).toEqual([]);
	});
});

describe("lateness and grace", () => {
	it.each([
		// [description, amIn, grace, forfeits, expected late]
		["08:02 with no grace", 482, 0, false, 2],
		["08:02 with 5 min grace", 482, 5, false, 0],
		["08:05 with 5 min grace (on the boundary)", 485, 5, false, 0],
		["08:06 with 5 min grace, courtesy", 486, 5, false, 1],
		["08:06 with 5 min grace, threshold", 486, 5, true, 6],
		["07:50 early", 470, 0, false, 0],
	])("%s -> %i late", (_label, amIn, graceMinutes, graceForfeits, expected) => {
		const { minutes } = run({
			punches: punches(amIn, 720, 780, 1020),
			policy: policy({ graceMinutes, graceForfeits }),
		});
		expect(minutes.lateMinutes).toBe(expected);
	});

	it("counts afternoon lateness separately", () => {
		const { minutes } = run({ punches: punches(480, 720, 795, 1020) });
		expect(minutes.lateMinutes).toBe(15);
	});

	it("adds morning and afternoon lateness together", () => {
		const { minutes } = run({ punches: punches(490, 720, 790, 1020) });
		expect(minutes.lateMinutes).toBe(20);
	});
});

describe("undertime", () => {
	it("counts leaving early in the afternoon", () => {
		const { minutes } = run({ punches: punches(480, 720, 780, 990) });
		expect(minutes.undertimeMinutes).toBe(30);
		expect(minutes.workedMinutes).toBe(450);
		expect(minutes.creditedRegularMinutes).toBe(450);
	});

	it("counts a short morning session", () => {
		const { minutes } = run({ punches: punches(480, 700, 780, 1020) });
		expect(minutes.undertimeMinutes).toBe(20);
	});
});

describe("overtime", () => {
	it("is dropped below the minimum and not paid without approval", () => {
		const { minutes } = run({ punches: punches(480, 720, 780, 1035) }); // +15m
		expect(minutes.overtimeMinutes).toBe(0);
		expect(minutes.flags).not.toContain("unapproved_overtime");
	});

	it("is capped at the approved amount, and flags the excess", () => {
		const { minutes } = run({
			punches: punches(480, 720, 780, 1140), // 17:00 -> 19:00 = 120m
			approvedOvertimeMinutes: 60,
		});
		expect(minutes.overtimeMinutes).toBe(60);
		expect(minutes.flags).toContain("unapproved_overtime");
	});

	it("pays the full amount when fully approved", () => {
		const { minutes } = run({
			punches: punches(480, 720, 780, 1140),
			approvedOvertimeMinutes: 120,
		});
		expect(minutes.overtimeMinutes).toBe(120);
		expect(minutes.flags).not.toContain("unapproved_overtime");
	});

	it("needs no approval when the policy does not require it", () => {
		const { minutes } = run({
			punches: punches(480, 720, 780, 1140),
			policy: policy({ overtimeRequiresApproval: false }),
		});
		expect(minutes.overtimeMinutes).toBe(120);
	});

	it("ignores pre-shift time unless the policy counts it", () => {
		const early = punches(420, 720, 780, 1020); // in at 07:00
		expect(
			run({
				punches: early,
				policy: policy({ overtimeRequiresApproval: false }),
			}).minutes.overtimeMinutes,
		).toBe(0);
		expect(
			run({
				punches: early,
				policy: policy({
					overtimeRequiresApproval: false,
					countPreShiftOvertime: true,
				}),
			}).minutes.overtimeMinutes,
		).toBe(60);
	});
});

describe("incomplete and malformed entries", () => {
	it("does not invent a full day when the afternoon clock-out is missing", () => {
		const { minutes } = run({ punches: punches(480, 720, 780, null) });
		expect(minutes.workedMinutes).toBe(240); // morning only
		expect(minutes.flags).toContain("missing_punch");
		// Crucially not 480, and not deducted as an absence either.
		expect(minutes.unpaidMinutes).toBe(0);
	});

	it("can fill a missing punch from the schedule when configured", () => {
		const { minutes } = run({
			punches: punches(480, 720, 780, null),
			policy: policy({ missingPunchPolicy: "assume_schedule" }),
		});
		expect(minutes.workedMinutes).toBe(480);
	});

	it("treats an empty scheduled workday as a gap, not an absence", () => {
		const { minutes } = run({ punches: punches(null, null, null, null) });
		expect(minutes.flags).toContain("missing_punch");
		expect(minutes.unpaidMinutes).toBe(0);
	});

	it("deducts an empty day only under the stricter policy", () => {
		const { minutes } = run({
			punches: punches(null, null, null, null),
			policy: policy({ missingPunchPolicy: "treat_as_absent" }),
		});
		expect(minutes.unpaidMinutes).toBe(480);
	});

	it("flags a transposed clock-out instead of inventing a 23-hour day", () => {
		const { minutes } = run({ punches: punches(480, 420, null, null) });
		expect(minutes.flags).toContain("out_before_in");
		expect(minutes.workedMinutes).toBe(0);
	});

	it("flags a future-dated entry", () => {
		const { minutes } = run({ date: assertIsoDate("2026-09-01") });
		expect(minutes.flags).toContain("future_date");
	});

	it("does not call an unfilled future workday a gap", () => {
		const { minutes } = run({
			date: assertIsoDate("2026-09-01"),
			punches: punches(null, null, null, null),
		});
		expect(minutes.flags).not.toContain("missing_punch");
	});

	it("flags a missing schedule", () => {
		const { minutes } = run({ schedule: null });
		expect(minutes.flags).toContain("no_schedule");
	});
});

describe("two-punch day", () => {
	it("collapses to one session and subtracts the break", () => {
		const { minutes } = run({ punches: punches(480, null, null, 1020) });
		expect(minutes.workedMinutes).toBe(480); // 9h span less a 1h break
		expect(minutes.flags).toContain("two_punch_day");
		expect(minutes.flags).not.toContain("missing_punch");
	});

	it("still measures lateness and undertime against the outer bounds", () => {
		const { minutes } = run({ punches: punches(490, null, null, 1000) });
		expect(minutes.lateMinutes).toBe(10);
		expect(minutes.undertimeMinutes).toBe(20);
	});

	it("falls back to flagging when the policy disallows it", () => {
		const { minutes } = run({
			punches: punches(480, null, null, 1020),
			policy: policy({ allowTwoPunchDay: false }),
		});
		expect(minutes.flags).toContain("missing_punch");
		expect(minutes.workedMinutes).toBe(0);
	});
});

describe("night shift crossing midnight", () => {
	it("normalizes the clock-out forward and keeps the row on its work date", () => {
		const { punches: normalized, minutes } = run({
			punches: punches(null, null, 1320, 90), // 22:00 -> 01:30
			schedule: null,
			policy: policy({ overtimeRequiresApproval: false }),
		});
		expect(normalized.pmOut).toBe(1530);
		expect(minutes.workedMinutes).toBe(210);
		expect(minutes.flags).toContain("crossed_midnight");
	});

	it("counts night-differential minutes across the midnight boundary", () => {
		const { minutes } = run({
			punches: punches(null, null, 1320, 360), // 22:00 -> 06:00
			schedule: null,
			policy: policy({
				nightDiffEnabled: true,
				overtimeRequiresApproval: false,
			}),
		});
		expect(minutes.workedMinutes).toBe(480);
		expect(minutes.nightDiffMinutes).toBe(480);
	});

	it("reports zero night differential while the feature is off", () => {
		const { minutes } = run({
			punches: punches(null, null, 1320, 360),
			schedule: null,
			policy: policy({ overtimeRequiresApproval: false }),
		});
		expect(minutes.nightDiffMinutes).toBe(0);
	});
});

describe("leave", () => {
	const amLeave: LeaveContext = {
		portion: "am",
		minutes: 240,
		startMinute: null,
		endMinute: null,
		isPaid: true,
	};

	it("forgives morning lateness on a morning half-day but still checks the afternoon", () => {
		const { minutes } = run({
			status: "half_day_leave",
			leave: amLeave,
			punches: punches(null, null, 795, 1020), // 15 min late after lunch
		});
		expect(minutes.lateMinutes).toBe(15);
		expect(minutes.paidLeaveMinutes).toBe(240);
		expect(minutes.unpaidMinutes).toBe(0);
	});

	it("mirrors that for an afternoon half-day", () => {
		const { minutes } = run({
			status: "half_day_leave",
			leave: { ...amLeave, portion: "pm" },
			punches: punches(490, 720, null, null), // 10 min late in the morning
		});
		expect(minutes.lateMinutes).toBe(10);
		expect(minutes.paidLeaveMinutes).toBe(240);
	});

	it("treats a full paid leave day as paid, with nothing deducted", () => {
		const { minutes } = run({
			status: "on_leave",
			leave: { ...amLeave, portion: "full", minutes: 480 },
			punches: punches(null, null, null, null),
		});
		expect(minutes.paidLeaveMinutes).toBe(480);
		expect(minutes.unpaidMinutes).toBe(0);
		expect(minutes.lateMinutes).toBe(0);
	});

	it("deducts unpaid leave", () => {
		const { minutes } = run({
			status: "on_leave",
			leave: { ...amLeave, portion: "full", minutes: 480, isPaid: false },
			punches: punches(null, null, null, null),
		});
		expect(minutes.unpaidMinutes).toBe(480);
		expect(minutes.paidLeaveMinutes).toBe(0);
	});
});

describe("absence and excused statuses", () => {
	it("deducts a full day when marked absent", () => {
		const { minutes } = run({
			status: "absent",
			punches: punches(null, null, null, null),
		});
		expect(minutes.unpaidMinutes).toBe(480);
		expect(minutes.creditedRegularMinutes).toBe(0);
	});

	it("does not double-count lateness on an absent day", () => {
		const { minutes } = run({
			status: "absent",
			punches: punches(600, 720, 780, 1020),
		});
		expect(minutes.lateMinutes).toBe(0);
		expect(minutes.unpaidMinutes).toBe(480);
	});

	it("pays official business and suspension without deduction", () => {
		for (const status of ["official_business", "suspended"] as const) {
			const { minutes } = run({
				status,
				punches: punches(null, null, null, null),
			});
			expect(minutes.paidLeaveMinutes, status).toBe(480);
			expect(minutes.unpaidMinutes, status).toBe(0);
		}
	});
});

describe("premium days while premiums are deferred", () => {
	it("flags a worked regular holiday rather than silently underpaying it", () => {
		const { minutes } = run({ dayKind: "regular_holiday" });
		expect(minutes.flags).toContain("holiday_premium_not_applied");
	});

	it("flags a worked rest day and treats the time as overtime", () => {
		const { minutes } = run({
			isRestDay: true,
			dayKind: "rest_day",
			schedule: REST_DAY_SCHEDULE,
			punches: punches(480, null, null, 720),
			policy: policy({ overtimeRequiresApproval: false }),
		});
		expect(minutes.flags).toContain("rest_day_premium_not_applied");
		expect(minutes.overtimeMinutes).toBeGreaterThan(0);
		expect(minutes.unpaidMinutes).toBe(0);
	});

	it("does not flag a holiday that was not worked", () => {
		const { minutes } = run({
			dayKind: "regular_holiday",
			status: "no_work",
			punches: punches(null, null, null, null),
		});
		expect(minutes.flags).not.toContain("holiday_premium_not_applied");
		expect(minutes.unpaidMinutes).toBe(0);
	});
});

describe("punch rounding", () => {
	it("leaves punches untouched by default", () => {
		const { punches: p } = normalizePunches(
			punches(482, 719, 781, 1021),
			DEFAULT_PUNCH_POLICY,
		);
		expect(p).toEqual(punches(482, 719, 781, 1021));
	});

	it("rounds toward the employee when configured", () => {
		const { punches: p } = normalizePunches(
			punches(482, 719, 781, 1021),
			policy({
				punchRoundingMinutes: 15,
				punchRoundingMode: "employee_favored",
			}),
		);
		// Clock-ins round down, clock-outs round up.
		expect(p).toEqual(punches(480, 720, 780, 1035));
	});

	it("rounds toward the employer when configured", () => {
		const { punches: p } = normalizePunches(
			punches(482, 719, 781, 1021),
			policy({
				punchRoundingMinutes: 15,
				punchRoundingMode: "employer_favored",
			}),
		);
		expect(p).toEqual(punches(495, 705, 795, 1020));
	});
});

describe("invariants", () => {
	const allTimes = [null, 0, 480, 490, 720, 780, 1020, 1140, 1439];

	it("never returns a negative or absurd value", () => {
		for (const amIn of allTimes) {
			for (const pmOut of allTimes) {
				const { minutes } = run({ punches: punches(amIn, 720, 780, pmOut) });
				for (const [key, value] of Object.entries(minutes)) {
					if (key === "flags") continue;
					expect(
						value as number,
						`${key} for ${amIn}/${pmOut}`,
					).toBeGreaterThanOrEqual(0);
					expect(
						value as number,
						`${key} for ${amIn}/${pmOut}`,
					).toBeLessThanOrEqual(2880);
				}
			}
		}
	});

	it("is deterministic", () => {
		const args = {
			punches: punches(486, 720, 790, 1100),
			approvedOvertimeMinutes: 45,
		};
		expect(run(args)).toEqual(run(args));
	});
});
