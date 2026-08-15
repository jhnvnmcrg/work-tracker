import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "#/components/layout/coming-soon.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/payslips/")({
	component: PayslipsPage,
});

function PayslipsPage() {
	return (
		<>
			<PageHeader
				title="Payslips"
				description="Two per month — the 1–16 and 17–end-of-month cutoffs."
			/>
			<ComingSoon feature="Payslips" phase="Phase 5">
				Earnings, statutory deductions (SSS, PhilHealth, Pag-IBIG, withholding
				tax) and net pay, each line traceable back to the DTR days that produced
				it.
			</ComingSoon>
		</>
	);
}
