import { relations } from "drizzle-orm";
import { dailyTimeRecords } from "./attendance.ts";
import { holidays } from "./calendar.ts";
import {
	employmentTerms,
	userProfiles,
	workScheduleDays,
	workSchedules,
} from "./identity.ts";
import {
	leaveLedger,
	leaveRequestDays,
	leaveRequests,
	leaveTypes,
} from "./leave.ts";
import {
	payPeriods,
	payslipLineItems,
	payslips,
	recurringAdjustments,
} from "./payroll.ts";
import { statutoryBrackets, statutorySchedules } from "./statutory.ts";

export const userProfilesRelations = relations(userProfiles, ({ many }) => ({
	employmentTerms: many(employmentTerms),
	workSchedules: many(workSchedules),
	timeRecords: many(dailyTimeRecords),
	payPeriods: many(payPeriods),
	payslips: many(payslips),
	leaveRequests: many(leaveRequests),
	leaveLedger: many(leaveLedger),
	recurringAdjustments: many(recurringAdjustments),
}));

export const employmentTermsRelations = relations(
	employmentTerms,
	({ one }) => ({
		user: one(userProfiles, {
			fields: [employmentTerms.userId],
			references: [userProfiles.userId],
		}),
	}),
);

export const workSchedulesRelations = relations(
	workSchedules,
	({ one, many }) => ({
		user: one(userProfiles, {
			fields: [workSchedules.userId],
			references: [userProfiles.userId],
		}),
		days: many(workScheduleDays),
	}),
);

export const workScheduleDaysRelations = relations(
	workScheduleDays,
	({ one }) => ({
		schedule: one(workSchedules, {
			fields: [workScheduleDays.scheduleId],
			references: [workSchedules.id],
		}),
	}),
);

export const dailyTimeRecordsRelations = relations(
	dailyTimeRecords,
	({ one }) => ({
		user: one(userProfiles, {
			fields: [dailyTimeRecords.userId],
			references: [userProfiles.userId],
		}),
		holiday: one(holidays, {
			fields: [dailyTimeRecords.holidayId],
			references: [holidays.id],
		}),
	}),
);

export const payPeriodsRelations = relations(payPeriods, ({ one, many }) => ({
	user: one(userProfiles, {
		fields: [payPeriods.userId],
		references: [userProfiles.userId],
	}),
	payslips: many(payslips),
}));

export const payslipsRelations = relations(payslips, ({ one, many }) => ({
	user: one(userProfiles, {
		fields: [payslips.userId],
		references: [userProfiles.userId],
	}),
	period: one(payPeriods, {
		fields: [payslips.payPeriodId],
		references: [payPeriods.id],
	}),
	lineItems: many(payslipLineItems),
}));

export const payslipLineItemsRelations = relations(
	payslipLineItems,
	({ one }) => ({
		payslip: one(payslips, {
			fields: [payslipLineItems.payslipId],
			references: [payslips.id],
		}),
	}),
);

export const leaveTypesRelations = relations(leaveTypes, ({ many }) => ({
	requests: many(leaveRequests),
	ledger: many(leaveLedger),
}));

export const leaveRequestsRelations = relations(
	leaveRequests,
	({ one, many }) => ({
		user: one(userProfiles, {
			fields: [leaveRequests.userId],
			references: [userProfiles.userId],
		}),
		leaveType: one(leaveTypes, {
			fields: [leaveRequests.leaveTypeId],
			references: [leaveTypes.id],
		}),
		days: many(leaveRequestDays),
	}),
);

export const leaveRequestDaysRelations = relations(
	leaveRequestDays,
	({ one }) => ({
		request: one(leaveRequests, {
			fields: [leaveRequestDays.requestId],
			references: [leaveRequests.id],
		}),
	}),
);

export const leaveLedgerRelations = relations(leaveLedger, ({ one }) => ({
	user: one(userProfiles, {
		fields: [leaveLedger.userId],
		references: [userProfiles.userId],
	}),
	leaveType: one(leaveTypes, {
		fields: [leaveLedger.leaveTypeId],
		references: [leaveTypes.id],
	}),
	sourceRequest: one(leaveRequests, {
		fields: [leaveLedger.sourceRequestId],
		references: [leaveRequests.id],
	}),
}));

export const statutorySchedulesRelations = relations(
	statutorySchedules,
	({ many }) => ({
		brackets: many(statutoryBrackets),
	}),
);

export const statutoryBracketsRelations = relations(
	statutoryBrackets,
	({ one }) => ({
		schedule: one(statutorySchedules, {
			fields: [statutoryBrackets.scheduleId],
			references: [statutorySchedules.id],
		}),
	}),
);
