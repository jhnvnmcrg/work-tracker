CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'on_leave', 'half_day_leave', 'official_business', 'no_work', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'recompute', 'finalize', 'void', 'lock', 'unlock');--> statement-breakpoint
CREATE TYPE "public"."base_pay_split_mode" AS ENUM('half_month_flat', 'daily_rate_working_days', 'calendar_proration');--> statement-breakpoint
CREATE TYPE "public"."day_kind" AS ENUM('regular_workday', 'rest_day', 'regular_holiday', 'special_non_working', 'special_working');--> statement-breakpoint
CREATE TYPE "public"."deduction_timing" AS ENUM('first_cutoff', 'second_cutoff', 'split_even', 'every_cutoff');--> statement-breakpoint
CREATE TYPE "public"."holiday_kind" AS ENUM('regular', 'special_non_working', 'special_working');--> statement-breakpoint
CREATE TYPE "public"."holiday_pay_mode" AS ENUM('incremental', 'gross_up');--> statement-breakpoint
CREATE TYPE "public"."holiday_scope" AS ENUM('national', 'local');--> statement-breakpoint
CREATE TYPE "public"."leave_accrual_mode" AS ENUM('none', 'monthly', 'annual', 'per_cutoff');--> statement-breakpoint
CREATE TYPE "public"."leave_day_portion" AS ENUM('full', 'am', 'pm', 'custom');--> statement-breakpoint
CREATE TYPE "public"."leave_ledger_source" AS ENUM('opening', 'accrual', 'usage', 'adjustment', 'forfeiture', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."line_item_category" AS ENUM('base_pay', 'overtime', 'night_differential', 'holiday_premium', 'rest_day_premium', 'leave_pay', 'allowance', 'bonus', 'adjustment', 'late', 'undertime', 'absence', 'sss', 'philhealth', 'pagibig', 'withholding_tax', 'loan', 'other_deduction');--> statement-breakpoint
CREATE TYPE "public"."line_item_section" AS ENUM('earnings', 'deductions');--> statement-breakpoint
CREATE TYPE "public"."missing_punch_policy" AS ENUM('flag_only', 'assume_schedule', 'treat_as_absent');--> statement-breakpoint
CREATE TYPE "public"."pay_period_half" AS ENUM('first', 'second');--> statement-breakpoint
CREATE TYPE "public"."pay_period_status" AS ENUM('open', 'locked');--> statement-breakpoint
CREATE TYPE "public"."payslip_status" AS ENUM('draft', 'finalized', 'voided');--> statement-breakpoint
CREATE TYPE "public"."payslip_type" AS ENUM('regular', 'thirteenth_month', 'final_pay', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."punch_rounding_mode" AS ENUM('none', 'nearest', 'employee_favored', 'employer_favored');--> statement-breakpoint
CREATE TYPE "public"."rate_rounding_mode" AS ENUM('amounts_only', 'round_rates');--> statement-breakpoint
CREATE TYPE "public"."statutory_kind" AS ENUM('sss', 'philhealth', 'pagibig', 'withholding_tax');--> statement-breakpoint
CREATE TYPE "public"."tax_period_type" AS ENUM('daily', 'weekly', 'semi_monthly', 'monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."unaccounted_day_policy" AS ENUM('warn', 'absent');--> statement-breakpoint
CREATE TABLE "daily_time_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_time_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"work_date" date NOT NULL,
	"am_in_minute" smallint,
	"am_out_minute" smallint,
	"pm_in_minute" smallint,
	"pm_out_minute" smallint,
	"day_kind" "day_kind" DEFAULT 'regular_workday' NOT NULL,
	"status" "attendance_status" DEFAULT 'present' NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"holiday_id" integer,
	"schedule_id" integer,
	"schedule_snapshot" jsonb,
	"worked_minutes" smallint DEFAULT 0 NOT NULL,
	"credited_regular_minutes" smallint DEFAULT 0 NOT NULL,
	"late_minutes" smallint DEFAULT 0 NOT NULL,
	"undertime_minutes" smallint DEFAULT 0 NOT NULL,
	"overtime_minutes" smallint DEFAULT 0 NOT NULL,
	"approved_overtime_minutes" smallint,
	"night_diff_minutes" smallint DEFAULT 0 NOT NULL,
	"night_diff_overtime_minutes" smallint DEFAULT 0 NOT NULL,
	"paid_leave_minutes" smallint DEFAULT 0 NOT NULL,
	"unpaid_minutes" smallint DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"compute_version" smallint DEFAULT 1 NOT NULL,
	"computed_at" timestamp with time zone,
	"locked_by_payslip_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dtr_punch_bounds_ck" CHECK (
				coalesce("daily_time_records"."am_in_minute", 0) BETWEEN 0 AND 2880
				AND coalesce("daily_time_records"."am_out_minute", 0) BETWEEN 0 AND 2880
				AND coalesce("daily_time_records"."pm_in_minute", 0) BETWEEN 0 AND 2880
				AND coalesce("daily_time_records"."pm_out_minute", 0) BETWEEN 0 AND 2880
			),
	CONSTRAINT "dtr_punch_order_ck" CHECK (
				("daily_time_records"."am_in_minute" IS NULL OR "daily_time_records"."am_out_minute" IS NULL OR "daily_time_records"."am_out_minute" >= "daily_time_records"."am_in_minute")
				AND ("daily_time_records"."pm_in_minute" IS NULL OR "daily_time_records"."pm_out_minute" IS NULL OR "daily_time_records"."pm_out_minute" >= "daily_time_records"."pm_in_minute")
				AND ("daily_time_records"."am_out_minute" IS NULL OR "daily_time_records"."pm_in_minute" IS NULL OR "daily_time_records"."pm_in_minute" >= "daily_time_records"."am_out_minute")
			)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"changed_fields" text[],
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "holidays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"kind" "holiday_kind" NOT NULL,
	"scope" "holiday_scope" DEFAULT 'national' NOT NULL,
	"region" text,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"proclamation_ref" text,
	"source_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_terms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employment_terms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"monthly_rate_centavos" bigint NOT NULL,
	"working_days_factor_x100" integer DEFAULT 31300 NOT NULL,
	"daily_hours" smallint DEFAULT 8 NOT NULL,
	"monthly_rate_covers_rest_days" boolean DEFAULT false NOT NULL,
	"monthly_rate_covers_holidays" boolean DEFAULT true NOT NULL,
	"base_pay_split_mode" "base_pay_split_mode" DEFAULT 'half_month_flat' NOT NULL,
	"holiday_pay_mode" "holiday_pay_mode" DEFAULT 'incremental' NOT NULL,
	"rate_rounding_mode" "rate_rounding_mode" DEFAULT 'amounts_only' NOT NULL,
	"sss_basis_centavos" bigint,
	"philhealth_basis_centavos" bigint,
	"pagibig_basis_centavos" bigint,
	"sss_timing" "deduction_timing" DEFAULT 'first_cutoff' NOT NULL,
	"philhealth_timing" "deduction_timing" DEFAULT 'first_cutoff' NOT NULL,
	"pagibig_timing" "deduction_timing" DEFAULT 'first_cutoff' NOT NULL,
	"tax_timing" "deduction_timing" DEFAULT 'every_cutoff' NOT NULL,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"night_diff_enabled" boolean DEFAULT false NOT NULL,
	"night_diff_start_minute" smallint DEFAULT 1320 NOT NULL,
	"night_diff_end_minute" smallint DEFAULT 360 NOT NULL,
	"premiums_enabled" boolean DEFAULT false NOT NULL,
	"overtime_requires_approval" boolean DEFAULT true NOT NULL,
	"count_pre_shift_overtime" boolean DEFAULT false NOT NULL,
	"min_overtime_minutes" smallint DEFAULT 30 NOT NULL,
	"grace_minutes" smallint DEFAULT 0 NOT NULL,
	"grace_forfeits" boolean DEFAULT false NOT NULL,
	"allow_two_punch_day" boolean DEFAULT true NOT NULL,
	"punch_rounding_minutes" smallint DEFAULT 0 NOT NULL,
	"punch_rounding_mode" "punch_rounding_mode" DEFAULT 'none' NOT NULL,
	"missing_punch_policy" "missing_punch_policy" DEFAULT 'flag_only' NOT NULL,
	"unaccounted_day_policy" "unaccounted_day_policy" DEFAULT 'warn' NOT NULL,
	"pay_date_offset_days" smallint DEFAULT 5 NOT NULL,
	"holiday_regions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_terms_range_ck" CHECK ("employment_terms"."effective_to" IS NULL OR "employment_terms"."effective_to" >= "employment_terms"."effective_from"),
	CONSTRAINT "employment_terms_factor_ck" CHECK ("employment_terms"."working_days_factor_x100" > 0),
	CONSTRAINT "employment_terms_rate_ck" CHECK ("employment_terms"."monthly_rate_centavos" >= 0),
	CONSTRAINT "employment_terms_hours_ck" CHECK ("employment_terms"."daily_hours" > 0 AND "employment_terms"."daily_hours" <= 24)
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"employee_no" text,
	"position" text,
	"department" text,
	"date_hired" date,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedule_days" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_schedule_days_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"schedule_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"am_in_minute" smallint,
	"am_out_minute" smallint,
	"pm_in_minute" smallint,
	"pm_out_minute" smallint,
	"standard_work_minutes" smallint DEFAULT 480 NOT NULL,
	"break_minutes" smallint DEFAULT 60 NOT NULL,
	CONSTRAINT "work_schedule_days_weekday_ck" CHECK ("work_schedule_days"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "work_schedule_days_order_ck" CHECK (
				("work_schedule_days"."am_in_minute" IS NULL OR "work_schedule_days"."am_out_minute" IS NULL OR "work_schedule_days"."am_out_minute" >= "work_schedule_days"."am_in_minute")
				AND ("work_schedule_days"."pm_in_minute" IS NULL OR "work_schedule_days"."pm_out_minute" IS NULL OR "work_schedule_days"."pm_out_minute" >= "work_schedule_days"."pm_in_minute")
			)
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "work_schedules_range_ck" CHECK ("work_schedules"."effective_to" IS NULL OR "work_schedules"."effective_to" >= "work_schedules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"leave_type_id" integer NOT NULL,
	"entry_date" date NOT NULL,
	"credit_year" smallint NOT NULL,
	"delta_minutes" integer NOT NULL,
	"source" "leave_ledger_source" NOT NULL,
	"source_request_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_request_days_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"request_id" integer NOT NULL,
	"leave_date" date NOT NULL,
	"portion" "leave_day_portion" DEFAULT 'full' NOT NULL,
	"minutes" smallint NOT NULL,
	"start_minute" smallint,
	"end_minute" smallint,
	"is_paid" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"leave_type_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"status" "leave_request_status" DEFAULT 'draft' NOT NULL,
	"reason" text,
	"filed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "leave_requests_range_ck" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date")
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual_mode" "leave_accrual_mode" DEFAULT 'none' NOT NULL,
	"accrual_minutes_per_period" integer DEFAULT 0 NOT NULL,
	"max_balance_minutes" integer,
	"max_carry_over_minutes" integer,
	"allows_half_day" boolean DEFAULT true NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"is_convertible" boolean DEFAULT false NOT NULL,
	"color_hex" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pay_periods_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"half" "pay_period_half" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pay_date" date NOT NULL,
	"day_count" smallint NOT NULL,
	"status" "pay_period_status" DEFAULT 'open' NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_periods_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "pay_periods_month_ck" CHECK ("pay_periods"."month" BETWEEN 1 AND 12),
	CONSTRAINT "pay_periods_year_ck" CHECK ("pay_periods"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "pay_periods_cutoff_ck" CHECK (
				("pay_periods"."half" = 'first'
					AND extract(day from "pay_periods"."start_date") = 1
					AND extract(day from "pay_periods"."end_date") = 16)
				OR ("pay_periods"."half" = 'second'
					AND extract(day from "pay_periods"."start_date") = 17
					AND "pay_periods"."end_date" = (date_trunc('month', "pay_periods"."start_date") + interval '1 month - 1 day')::date)
			)
);
--> statement-breakpoint
CREATE TABLE "payslip_line_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payslip_line_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"payslip_id" integer NOT NULL,
	"section" "line_item_section" NOT NULL,
	"category" "line_item_category" NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"quantity" integer,
	"unit" text,
	"rate_micro_centavos" bigint,
	"multiplier_ppm" integer,
	"amount_centavos" bigint NOT NULL,
	"reduces_taxable_gross" boolean DEFAULT false NOT NULL,
	"is_taxable" boolean DEFAULT true NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"computation" jsonb,
	"source_type" text,
	"source_id" integer,
	"meta" jsonb,
	CONSTRAINT "payslip_line_items_amount_ck" CHECK ("payslip_line_items"."amount_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payslips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"pay_period_id" integer NOT NULL,
	"type" "payslip_type" DEFAULT 'regular' NOT NULL,
	"status" "payslip_status" DEFAULT 'draft' NOT NULL,
	"monthly_rate_centavos" bigint NOT NULL,
	"working_days_factor_x100" integer NOT NULL,
	"daily_rate_centavos" bigint NOT NULL,
	"hourly_rate_centavos" bigint NOT NULL,
	"days_present" smallint DEFAULT 0 NOT NULL,
	"days_absent" smallint DEFAULT 0 NOT NULL,
	"days_on_leave" smallint DEFAULT 0 NOT NULL,
	"days_holiday" smallint DEFAULT 0 NOT NULL,
	"regular_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"undertime_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"night_diff_minutes" integer DEFAULT 0 NOT NULL,
	"paid_leave_minutes" integer DEFAULT 0 NOT NULL,
	"base_pay_centavos" bigint DEFAULT 0 NOT NULL,
	"total_earnings_centavos" bigint DEFAULT 0 NOT NULL,
	"taxable_gross_centavos" bigint DEFAULT 0 NOT NULL,
	"non_taxable_centavos" bigint DEFAULT 0 NOT NULL,
	"gross_pay_centavos" bigint DEFAULT 0 NOT NULL,
	"total_deductions_centavos" bigint DEFAULT 0 NOT NULL,
	"net_pay_centavos" bigint DEFAULT 0 NOT NULL,
	"sss_ee_centavos" bigint DEFAULT 0 NOT NULL,
	"sss_er_centavos" bigint DEFAULT 0 NOT NULL,
	"philhealth_ee_centavos" bigint DEFAULT 0 NOT NULL,
	"philhealth_er_centavos" bigint DEFAULT 0 NOT NULL,
	"pagibig_ee_centavos" bigint DEFAULT 0 NOT NULL,
	"pagibig_er_centavos" bigint DEFAULT 0 NOT NULL,
	"withholding_tax_centavos" bigint DEFAULT 0 NOT NULL,
	"engine_version" smallint DEFAULT 1 NOT NULL,
	"computation_snapshot" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finalized_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "payslips_net_ck" CHECK ("payslips"."net_pay_centavos" = "payslips"."gross_pay_centavos" - "payslips"."total_deductions_centavos")
);
--> statement-breakpoint
CREATE TABLE "recurring_adjustments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"section" "line_item_section" NOT NULL,
	"category" "line_item_category" NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"is_taxable" boolean DEFAULT true NOT NULL,
	"timing" "deduction_timing" DEFAULT 'every_cutoff' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"principal_centavos" bigint,
	"remaining_centavos" bigint,
	"installments_total" smallint,
	"installments_paid" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_adjustments_amount_ck" CHECK ("recurring_adjustments"."amount_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "premium_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "premium_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text,
	"day_kind" "day_kind" NOT NULL,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"worked" boolean DEFAULT true NOT NULL,
	"day_multiplier_ppm" integer NOT NULL,
	"overtime_multiplier_ppm" integer DEFAULT 1250000 NOT NULL,
	"night_diff_rate_ppm" integer DEFAULT 100000 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"label" text,
	"source_citation" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_brackets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "statutory_brackets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"schedule_id" integer NOT NULL,
	"period_type" "tax_period_type" DEFAULT 'monthly' NOT NULL,
	"range_from_centavos" bigint NOT NULL,
	"range_to_centavos" bigint,
	"salary_credit_centavos" bigint,
	"employee_amount_centavos" bigint,
	"employer_amount_centavos" bigint,
	"employer_ec_amount_centavos" bigint,
	"employee_mpf_centavos" bigint,
	"employer_mpf_centavos" bigint,
	"employee_rate_ppm" integer,
	"employer_rate_ppm" integer,
	"cap_centavos" bigint,
	"base_amount_centavos" bigint,
	"excess_rate_ppm" integer,
	"meta" jsonb,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "statutory_brackets_range_ck" CHECK ("statutory_brackets"."range_to_centavos" IS NULL OR "statutory_brackets"."range_to_centavos" >= "statutory_brackets"."range_from_centavos")
);
--> statement-breakpoint
CREATE TABLE "statutory_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "statutory_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text,
	"kind" "statutory_kind" NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"rate_ppm" integer,
	"employee_share_ppm" integer,
	"floor_centavos" bigint,
	"ceiling_centavos" bigint,
	"source_url" text,
	"source_citation" text,
	"verified_at" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_schedules_range_ck" CHECK ("statutory_schedules"."effective_to" IS NULL OR "statutory_schedules"."effective_to" >= "statutory_schedules"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "daily_time_records" ADD CONSTRAINT "daily_time_records_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_time_records" ADD CONSTRAINT "daily_time_records_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_days" ADD CONSTRAINT "work_schedule_days_schedule_fk" FOREIGN KEY ("user_id","schedule_id") REFERENCES "public"."work_schedules"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_source_request_id_leave_requests_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_request_fk" FOREIGN KEY ("user_id","request_id") REFERENCES "public"."leave_requests"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_payslip_fk" FOREIGN KEY ("user_id","payslip_id") REFERENCES "public"."payslips"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_period_fk" FOREIGN KEY ("user_id","pay_period_id") REFERENCES "public"."pay_periods"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_adjustments" ADD CONSTRAINT "recurring_adjustments_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_rules" ADD CONSTRAINT "premium_rules_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_brackets" ADD CONSTRAINT "statutory_brackets_schedule_id_statutory_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."statutory_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_schedules" ADD CONSTRAINT "statutory_schedules_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dtr_user_date_uq" ON "daily_time_records" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "dtr_user_date_desc_idx" ON "daily_time_records" USING btree ("user_id","work_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dtr_user_kind_idx" ON "daily_time_records" USING btree ("user_id","day_kind","work_date");--> statement-breakpoint
CREATE INDEX "dtr_user_status_idx" ON "daily_time_records" USING btree ("user_id","status","work_date");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("user_id","entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_time_idx" ON "audit_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("user_id","action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_global_uq" ON "holidays" USING btree ("holiday_date","name") WHERE "holidays"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_user_uq" ON "holidays" USING btree ("user_id","holiday_date","name") WHERE "holidays"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("holiday_date");--> statement-breakpoint
CREATE INDEX "holidays_user_date_idx" ON "holidays" USING btree ("user_id","holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_terms_user_from_uq" ON "employment_terms" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX "employment_terms_lookup_idx" ON "employment_terms" USING btree ("user_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedule_days_uq" ON "work_schedule_days" USING btree ("schedule_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_user_from_uq" ON "work_schedules" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX "leave_ledger_balance_idx" ON "leave_ledger" USING btree ("user_id","leave_type_id","credit_year");--> statement-breakpoint
CREATE INDEX "leave_ledger_user_date_idx" ON "leave_ledger" USING btree ("user_id","entry_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_usage_uq" ON "leave_ledger" USING btree ("source_request_id") WHERE "leave_ledger"."source" = 'usage';--> statement-breakpoint
CREATE UNIQUE INDEX "leave_request_days_uq" ON "leave_request_days" USING btree ("request_id","leave_date");--> statement-breakpoint
CREATE INDEX "leave_request_days_user_date_idx" ON "leave_request_days" USING btree ("user_id","leave_date");--> statement-breakpoint
CREATE INDEX "leave_requests_user_range_idx" ON "leave_requests" USING btree ("user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_user_status_idx" ON "leave_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_user_code_uq" ON "leave_types" USING btree ("user_id","code") WHERE "leave_types"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_global_code_uq" ON "leave_types" USING btree ("code") WHERE "leave_types"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_periods_user_period_uq" ON "pay_periods" USING btree ("user_id","year","month","half");--> statement-breakpoint
CREATE INDEX "pay_periods_user_range_idx" ON "pay_periods" USING btree ("user_id","start_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payslip_line_items_payslip_idx" ON "payslip_line_items" USING btree ("payslip_id","sort_order");--> statement-breakpoint
CREATE INDEX "payslip_line_items_user_cat_idx" ON "payslip_line_items" USING btree ("user_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_regular_uq" ON "payslips" USING btree ("user_id","pay_period_id") WHERE "payslips"."type" = 'regular' AND "payslips"."status" <> 'voided';--> statement-breakpoint
CREATE INDEX "payslips_user_status_idx" ON "payslips" USING btree ("user_id","status","finalized_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recurring_adjustments_lookup_idx" ON "recurring_adjustments" USING btree ("user_id","is_active","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_adjustments_code_uq" ON "recurring_adjustments" USING btree ("user_id","code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_rules_global_uq" ON "premium_rules" USING btree ("day_kind","is_rest_day","worked","effective_from") WHERE "premium_rules"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "premium_rules_user_uq" ON "premium_rules" USING btree ("user_id","day_kind","is_rest_day","worked","effective_from") WHERE "premium_rules"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "premium_rules_lookup_idx" ON "premium_rules" USING btree ("day_kind","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_brackets_uq" ON "statutory_brackets" USING btree ("schedule_id","period_type","range_from_centavos");--> statement-breakpoint
CREATE INDEX "statutory_brackets_lookup_idx" ON "statutory_brackets" USING btree ("schedule_id","period_type","range_from_centavos","range_to_centavos");--> statement-breakpoint
CREATE INDEX "statutory_schedules_lookup_idx" ON "statutory_schedules" USING btree ("kind","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "statutory_schedules_user_lookup_idx" ON "statutory_schedules" USING btree ("user_id","kind","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_schedules_global_uq" ON "statutory_schedules" USING btree ("kind","effective_from") WHERE "statutory_schedules"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_schedules_user_uq" ON "statutory_schedules" USING btree ("user_id","kind","effective_from") WHERE "statutory_schedules"."user_id" IS NOT NULL;