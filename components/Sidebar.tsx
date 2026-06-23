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
  Trash2,
  Tags,
  Settings,
  LogOut,
} from "lucide-react";
import clsx from "clsx";

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/ingredients", label: "Ingrédients", icon: Package },
      { href: "/recipes",     label: "Recettes",    icon: ChefHat },
      { href: "/menu",        label: "Menu",        icon: UtensilsCrossed },
      { href: "/categories",  label: "Catégories",  icon: Tags },
    ],
  },
  {
    label: "Opérations",
    items: [
      { href: "/orders",      label: "Commandes",    icon: ShoppingCart },
      { href: "/suppliers",   label: "Fournisseurs", icon: Truck },
      { href: "/inventaire",  label: "Inventaire",   icon: Warehouse },
      { href: "/pertes",      label: "Pertes",       icon: Trash2 },
    ],
  },
  {
    label: "Analyse",
    items: [
      { href: "/rentabilite", label: "Rentabilité", icon: TrendingUp },
    ],
  },
];

export default function Sidebar({ restaurantName }: { restaurantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 flex flex-col h-screen sticky top-0 bg-white border-r border-gray-100">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-sm text-base">
            🍽
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xs text-gray-400 uppercase tracking-wider font-semibold leading-none">Restaurant</p>
            <p className="text-sm font-semibold text-gray-900 truncate leading-snug mt-0.5">
              {restaurantName}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-3 mb-1 text-2xs font-semibold text-gray-400 uppercase tracking-widest">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
                      active
                        ? "bg-emerald-50 text-emerald-700 font-semibold"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                    )}
                  >
                    <Icon
                      size={15}
                      className={active ? "text-emerald-600" : "text-gray-400"}
                      strokeWidth={active ? 2.5 : 2}
                    />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-3 pt-2 border-t border-gray-100 space-y-0.5">
        <Link
          href="/settings"
          className={clsx(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
            pathname === "/settings"
              ? "bg-emerald-50 text-emerald-700 font-semibold"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          )}
        >
          <Settings size={15} className={pathname === "/settings" ? "text-emerald-600" : "text-gray-400"} strokeWidth={2} />
          Paramètres
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <LogOut size={15} className="text-gray-400" strokeWidth={2} />
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}
