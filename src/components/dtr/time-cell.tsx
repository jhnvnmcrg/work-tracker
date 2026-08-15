import { useEffect, useState } from "react";
import { formatHHmm, parseTimeInput } from "#/lib/payroll/time.ts";
import { cn } from "#/lib/utils.ts";

/**
 * A single punch cell.
 *
 * Accepts the shorthand people actually type — `8`, `800`, `8a`, `1pm`,
 * `13:00` — so filling a month needs no colons and no AM/PM picker. The value
 * is only committed on blur or Enter, which keeps a half-typed "8" from being
 * saved as 08:00 mid-keystroke.
 */
export function TimeCell({
	value,
	onCommit,
	disabled,
	invalid,
	label,
	cellRef,
}: {
	value: number | null;
	onCommit: (next: number | null) => void;
	disabled?: boolean;
	invalid?: boolean;
	label: string;
	cellRef?: string;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const [rejected, setRejected] = useState(false);

	// Reset the draft when the row is refreshed from the server.
	useEffect(() => {
		setDraft(null);
		setRejected(false);
	}, []);

	const display =
		draft ?? (value === null ? "" : formatHHmm(value).replace(/\s\(.*\)$/, ""));
	const crossesMidnight = value !== null && value >= 1440;

	function commit(raw: string) {
		const trimmed = raw.trim();
		if (trimmed === "") {
			setRejected(false);
			setDraft(null);
			if (value !== null) onCommit(null);
			return;
		}
		const parsed = parseTimeInput(trimmed);
		if (parsed === null) {
			// Keep what they typed so it can be corrected rather than silently lost.
			setRejected(true);
			return;
		}
		setRejected(false);
		setDraft(null);
		if (parsed !== value) onCommit(parsed);
	}

	return (
		<div className="relative">
			<input
				aria-label={label}
				aria-invalid={rejected || invalid}
				data-cell={cellRef}
				disabled={disabled}
				value={display}
				inputMode="numeric"
				autoComplete="off"
				className={cn(
					"h-8 w-full rounded-md border bg-transparent px-2 text-center text-sm tabular-nums",
					"focus:outline-none focus:ring-2 focus:ring-ring",
					"disabled:cursor-not-allowed disabled:opacity-50",
					rejected && "border-destructive text-destructive",
					invalid && !rejected && "border-destructive/60",
				)}
				onChange={(e) => {
					setDraft(e.target.value);
					if (rejected) setRejected(false);
				}}
				onBlur={(e) => commit(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit(e.currentTarget.value);
					if (e.key === "Escape") {
						setDraft(null);
						setRejected(false);
						e.currentTarget.blur();
					}
				}}
			/>
			{crossesMidnight ? (
				<span
					className="pointer-events-none absolute -top-1 -right-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground"
					title="Next day"
				>
					+1
				</span>
			) : null}
		</div>
	);
}
