"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { logout } from "@/app/auth/actions";
import {
  LayoutDashboard,
  Package,
  ChefHat,
  Soup,
  UtensilsCrossed,
  ShoppingCart,
  Truck,
  TrendingUp,
  Warehouse,
  ClipboardList,
  Trash2,
  Tags,
  CreditCard,
  Settings,
  LogOut,
} from "lucide-react";
import clsx from "clsx";

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Accueil", icon: LayoutDashboard },
    ],
  },
  {
    label: "Ma cuisine",
    items: [
      { href: "/ingredients",    label: "Ingrédients",    icon: Package },
      { href: "/mises-en-place", label: "Mises en place", icon: Soup },
      { href: "/recipes",        label: "Recettes",       icon: ChefHat },
      { href: "/menu",        label: "Ma carte",    icon: UtensilsCrossed },
      { href: "/categories",  label: "Catégories & tags",  icon: Tags },
      { href: "/pertes",      label: "Pertes",      icon: Trash2 },
    ],
  },
  {
    label: "Achats & stock",
    items: [
      { href: "/orders",      label: "Commandes",    icon: ShoppingCart },
      { href: "/suppliers",   label: "Fournisseurs", icon: Truck },
      { href: "/inventaire?vue=inventaire", label: "Inventaire", icon: ClipboardList },
      { href: "/inventaire",  label: "Stock",        icon: Warehouse },
    ],
  },
  {
    label: "Mon activité",
    items: [
      { href: "/caisse",      label: "Caisse",   icon: CreditCard },
      { href: "/rentabilite", label: "Ventes & marges", icon: TrendingUp },
    ],
  },
];

export default function Sidebar({ restaurantName }: { restaurantName: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const vue = searchParams.get("vue");

  // The two /inventaire entries (Stock vs Inventaire) share one route and are
  // distinguished by the ?vue=inventaire param; everything else matches by path.
  function isActive(href: string) {
    if (href.startsWith("/inventaire")) {
      if (pathname !== "/inventaire") return false;
      return href.includes("vue=inventaire") ? vue === "inventaire" : vue !== "inventaire";
    }
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col h-screen sticky top-0 bg-surface-container-lowest border-r border-outline-variant">
      {/* Brand — Amaly wordmark (clic → accueil) */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/dashboard" aria-label="Accueil">
          <p className="text-[32px] leading-none font-extrabold text-primary tracking-tight hover:opacity-80 transition">
            Amaly
          </p>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-3 overflow-y-auto space-y-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-3 mb-2 text-2xs font-bold text-on-surface-variant/50 uppercase tracking-widest">
                {group.label}
              </p>
            )}
            <div className="space-y-1">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
                      active
                        ? "bg-primary-container text-on-primary-container font-bold nav-active-glow"
                        : "text-on-surface-variant hover:bg-surface-variant/40"
                    )}
                  >
                    <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 pt-3 border-t border-outline-variant space-y-1">
        <Link
          href="/settings"
          className={clsx(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
            pathname === "/settings"
              ? "bg-primary-container text-on-primary-container font-bold nav-active-glow"
              : "text-on-surface-variant hover:bg-surface-variant/40"
          )}
        >
          <Settings size={18} strokeWidth={2} />
          Paramètres
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface-variant hover:bg-red-light hover:text-red transition-all"
          >
            <LogOut size={18} strokeWidth={2} />
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}
