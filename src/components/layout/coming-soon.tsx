import { Construction } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";

/**
 * Honest placeholder for routes whose shell exists but whose feature is not
 * built yet. Keeps navigation verifiable end to end without implying the page
 * works.
 */
export function ComingSoon({
	feature,
	phase,
	children,
}: {
	feature: string;
	phase: string;
	children?: React.ReactNode;
}) {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<div className="flex items-center gap-2 text-muted-foreground">
					<Construction className="size-4" />
					<CardDescription>{phase}</CardDescription>
				</div>
				<CardTitle className="font-serif text-lg">{feature}</CardTitle>
			</CardHeader>
			{children ? (
				<CardContent className="text-sm text-muted-foreground">
					{children}
				</CardContent>
			) : null}
		</Card>
	);
}
