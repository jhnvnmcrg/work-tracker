import { SignInButton, SignUpButton } from "@clerk/tanstack-react-start";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CalendarClock, ReceiptText, Sparkles } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { getOptionalUserId } from "#/server/auth.ts";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const { userId } = await getOptionalUserId();
		if (userId) throw redirect({ to: "/dtr" });
	},
	component: LandingPage,
});

const FEATURES = [
	{
		icon: CalendarClock,
		title: "Your daily time record",
		body: "Fill in the four punches for each day — AM in and out, PM in and out — a whole month at a time. Late, undertime and overtime are computed for you.",
	},
	{
		icon: ReceiptText,
		title: "Payslips per cutoff",
		body: "Two payslips a month, for the 1st–16th and the 17th to month end, with SSS, PhilHealth, Pag-IBIG and withholding tax — every line traceable back to the days that produced it.",
	},
	{
		icon: Sparkles,
		title: "An assistant that reads your records",
		body: "Ask how many hours you worked or why a deduction changed. Every figure comes from your own data, never a guess.",
	},
];

function LandingPage() {
	return (
		<div className="page-wrap py-16 md:py-24">
			<section className="rise-in max-w-2xl">
				<p className="text-sm font-medium text-muted-foreground">
					Personal work tracker
				</p>
				<h1 className="mt-3 text-balance text-4xl font-bold tracking-tight md:text-5xl">
					Keep your own time record, and know exactly what you earned.
				</h1>
				<p className="mt-5 text-lg text-muted-foreground">
					A private daily time record and payslip system built around Philippine
					semi-monthly payroll.
				</p>
				<div className="mt-8 flex flex-wrap gap-3">
					<SignUpButton mode="modal">
						<Button size="lg">Get started</Button>
					</SignUpButton>
					<SignInButton mode="modal">
						<Button size="lg" variant="outline">
							Sign in
						</Button>
					</SignInButton>
				</div>
			</section>

			<section className="mt-16 grid gap-4 md:grid-cols-3">
				{FEATURES.map((feature) => (
					<div key={feature.title} className="rounded-xl border bg-card p-5">
						<feature.icon className="size-5 text-primary" />
						<h2 className="mt-3 text-lg font-semibold">{feature.title}</h2>
						<p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
					</div>
				))}
			</section>
		</div>
	);
}
