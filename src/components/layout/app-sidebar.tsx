import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	CalendarClock,
	CalendarDays,
	LayoutDashboard,
	Plane,
	ReceiptText,
	Settings,
	Sparkles,
} from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "#/components/ui/sidebar.tsx";

type NavItem = {
	to: string;
	label: string;
	icon: LucideIcon;
};

const NAV_MAIN: NavItem[] = [
	{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ to: "/dtr", label: "Daily Time Record", icon: CalendarClock },
	{ to: "/payslips", label: "Payslips", icon: ReceiptText },
	{ to: "/leave", label: "Leave", icon: Plane },
	{ to: "/holidays", label: "Holidays", icon: CalendarDays },
];

const NAV_SECONDARY: NavItem[] = [
	{ to: "/assistant", label: "Assistant", icon: Sparkles },
	{ to: "/settings", label: "Settings", icon: Settings },
];

/** `/dtr` should stay highlighted while on `/dtr/2026-08`. */
function isActivePath(pathname: string, to: string): boolean {
	return pathname === to || pathname.startsWith(`${to}/`);
}

function NavList({ items, pathname }: { items: NavItem[]; pathname: string }) {
	return (
		<SidebarMenu>
			{items.map((item) => (
				<SidebarMenuItem key={item.to}>
					<SidebarMenuButton
						asChild
						isActive={isActivePath(pathname, item.to)}
						tooltip={item.label}
					>
						<Link to={item.to}>
							<item.icon />
							<span>{item.label}</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
			))}
		</SidebarMenu>
	);
}

export function AppSidebar() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild size="lg">
							<Link to="/dashboard">
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
									<CalendarClock className="size-4" />
								</div>
								<div className="grid flex-1 text-left leading-tight">
									<span className="truncate font-serif text-base font-semibold">
										Work Tracker
									</span>
									<span className="truncate text-xs text-muted-foreground">
										DTR &amp; payslips
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Records</SidebarGroupLabel>
					<SidebarGroupContent>
						<NavList items={NAV_MAIN} pathname={pathname} />
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter>
				<NavList items={NAV_SECONDARY} pathname={pathname} />
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
