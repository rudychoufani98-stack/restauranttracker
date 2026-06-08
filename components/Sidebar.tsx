"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/app/auth/actions";
import {
  LayoutDashboard,
  Package,
  ChefHat,
  UtensilsCrossed,
  ShoppingCart,
  Truck,
  Settings,
  LogOut,
} from "lucide-react";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { href: "/ingredients",  label: "Ingredients",  icon: Package },
  { href: "/recipes",      label: "Recipes",      icon: ChefHat },
  { href: "/menu",         label: "Menu",         icon: UtensilsCrossed },
  { href: "/orders",       label: "Orders",       icon: ShoppingCart },
  { href: "/suppliers",    label: "Suppliers",    icon: Truck },
  { href: "/settings",     label: "Settings",     icon: Settings },
];

interface SidebarProps {
  restaurantName: string;
}

export default function Sidebar({ restaurantName }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-[#E5E7EB] flex flex-col h-screen sticky top-0">
      {/* Logo / restaurant name */}
      <div className="px-4 py-5 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-sm">
            🍽
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-400 leading-none">Restaurant</p>
            <p className="text-sm font-medium text-gray-900 truncate leading-tight mt-0.5">
              {restaurantName}
            </p>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                active
                  ? "bg-emerald-50 text-emerald-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon size={16} className={active ? "text-emerald-600" : "text-gray-400"} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-[#E5E7EB]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 w-full transition"
        >
          <LogOut size={16} className="text-gray-400" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
