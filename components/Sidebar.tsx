"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/auth/actions";
import {
  LayoutDashboard,
  Package,
  ChefHat,
  UtensilsCrossed,
  ShoppingCart,
  Truck,
  TrendingUp,
  Warehouse,
  Settings,
  LogOut,
} from "lucide-react";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard",   label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/ingredients", label: "Ingrédients",     icon: Package },
  { href: "/recipes",     label: "Recettes",        icon: ChefHat },
  { href: "/menu",        label: "Menu",            icon: UtensilsCrossed },
  { href: "/orders",      label: "Commandes",       icon: ShoppingCart },
  { href: "/suppliers",   label: "Fournisseurs",    icon: Truck },
  { href: "/inventaire",  label: "Inventaire",      icon: Warehouse },
  { href: "/rentabilite", label: "Rentabilité",     icon: TrendingUp },
];

export default function Sidebar({ restaurantName }: { restaurantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 flex flex-col h-screen sticky top-0 bg-white border-r border-gray-100">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green flex items-center justify-center shadow-sm text-sm">
            🍽
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xs text-gray-400 uppercase tracking-wider font-medium leading-none">Restaurant</p>
            <p className="text-sm font-semibold text-gray-900 truncate leading-snug mt-0.5">
              {restaurantName}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
                active
                  ? "bg-green/10 text-green font-medium"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
              )}
            >
              <Icon
                size={15}
                className={active ? "text-green" : "text-gray-400"}
                strokeWidth={active ? 2.5 : 2}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-3 pt-2 border-t border-gray-100 space-y-0.5">
        <Link
          href="/settings"
          className={clsx(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
            pathname === "/settings"
              ? "bg-green/10 text-green font-medium"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          )}
        >
          <Settings size={15} className={pathname === "/settings" ? "text-green" : "text-gray-400"} strokeWidth={2} />
          Paramètres
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-all"
          >
            <LogOut size={15} className="text-gray-400" strokeWidth={2} />
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}
