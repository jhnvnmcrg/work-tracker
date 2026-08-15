import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ReceiptText } from "lucide-react";
import { PageHeader } from "#/components/layout/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { formatPeso } from "#/lib/payroll/money.ts";
import { getPayslipList } from "#/server/payroll.ts";

const payslipListQuery = queryOptions({
	queryKey: ["payslip", "list"] as const,
	queryFn: () => getPayslipList({ data: {} }),
});

export const Route = createFileRoute("/_app/payslips/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(payslipListQuery),
	component: PayslipsPage,
});

function PayslipsPage() {
	const { data } = useSuspenseQuery(payslipListQuery);

	return (
		<>
			<PageHeader
				title="Payslips"
				description="Two per month — the 1–16 and 17–end-of-month cutoffs."
				actions={
					<Button asChild>
						<Link
							to="/payslips/$periodKey"
							params={{ periodKey: data.currentPeriodKey }}
						>
							<ReceiptText className="size-4" />
							Current cutoff
						</Link>
					</Button>
				}
			/>

			<section className="mb-6 grid gap-3 sm:grid-cols-3">
				{[
					["Year to date gross", data.ytd.gross],
					["Year to date deductions", data.ytd.deductions],
					["Year to date net", data.ytd.net],
				].map(([label, value]) => (
					<Card key={label as string}>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								{label}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="font-serif text-2xl font-semibold tabular-nums">
								{formatPeso(value as number)}
							</p>
						</CardContent>
					</Card>
				))}
			</section>

			<Card>
				<CardHeader>
					<CardTitle className="font-serif text-base">
						Finalized payslips
					</CardTitle>
				</CardHeader>
				<CardContent>
					{data.items.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Nothing finalized yet. Open the current cutoff to preview it — a
							preview recomputes from your time records every time, so it is
							never stale.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[38rem] text-sm">
								<thead>
									<tr className="border-b text-left text-xs text-muted-foreground">
										<th className="py-2 font-medium">Period</th>
										<th className="py-2 font-medium">Pay date</th>
										<th className="py-2 text-right font-medium">Gross</th>
										<th className="py-2 text-right font-medium">Deductions</th>
										<th className="py-2 text-right font-medium">Net</th>
										<th className="py-2" />
									</tr>
								</thead>
								<tbody>
									{data.items.map((item) => (
										<tr key={item.id} className="border-b last:border-0">
											<td className="py-2">{item.label}</td>
											<td className="py-2 tabular-nums">{item.payDate}</td>
											<td className="py-2 text-right tabular-nums">
												{formatPeso(item.grossPayCentavos)}
											</td>
											<td className="py-2 text-right tabular-nums">
												{formatPeso(item.totalDeductionsCentavos)}
											</td>
											<td className="py-2 text-right font-medium tabular-nums">
												{formatPeso(item.netPayCentavos)}
											</td>
											<td className="py-2 text-right">
												<Button variant="ghost" size="sm" asChild>
													<Link
														to="/payslips/$periodKey"
														params={{ periodKey: item.periodKey }}
													>
														<ArrowRight className="size-4" />
														<span className="sr-only">Open</span>
													</Link>
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}
