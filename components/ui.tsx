import clsx from "clsx";
import { ReactNode } from "react";

// ── Page wrapper ────────────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="ml-4 shrink-0">{action}</div>}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────
export function Card({
  children,
  className,
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={clsx(
        "bg-white border border-gray-200 rounded-card shadow-card",
        padding && "p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  color = "default",
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "default" | "green" | "amber" | "red" | "blue";
  icon?: ReactNode;
}) {
  const cfg = {
    default: { value: "text-gray-900", bg: "bg-gray-100", icon: "text-gray-500", bar: "bg-gray-200" },
    green:   { value: "text-emerald-700", bg: "bg-emerald-50", icon: "text-emerald-600", bar: "bg-emerald-400" },
    amber:   { value: "text-amber-700", bg: "bg-amber-50", icon: "text-amber-600", bar: "bg-amber-400" },
    red:     { value: "text-red-600", bg: "bg-red-50", icon: "text-red-500", bar: "bg-red-400" },
    blue:    { value: "text-blue-700", bg: "bg-blue-50", icon: "text-blue-600", bar: "bg-blue-400" },
  }[color];

  return (
    <div className="bg-white border border-gray-200 rounded-card shadow-card overflow-hidden">
      <div className={clsx("h-1 w-full", cfg.bar)} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          {icon && (
            <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center", cfg.bg)}>
              <span className={cfg.icon}>{icon}</span>
            </div>
          )}
        </div>
        <p className={clsx("text-2xl font-bold tracking-tight", cfg.value)}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────
type BadgeVariant = "gray" | "green" | "amber" | "red" | "blue";
export function Badge({
  children,
  variant = "gray",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
}) {
  const styles: Record<BadgeVariant, string> = {
    gray: "bg-gray-100 text-gray-600",
    green: "bg-green-light text-green-dark",
    amber: "bg-amber-light text-amber-dark",
    red: "bg-red-light text-red-dark",
    blue: "bg-blue-light text-blue-dark",
  };
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", styles[variant])}>
      {children}
    </span>
  );
}

// ── Button ───────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const base = "inline-flex items-center gap-1.5 font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-green text-white hover:bg-green-600 shadow-sm",
    secondary: "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 shadow-sm",
    ghost: "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
    danger: "text-red-600 border border-red-200 hover:bg-red-50",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={clsx(base, sizes[size], variants[variant], className)}>
      {children}
    </button>
  );
}

// ── Input ────────────────────────────────────────────────────────────
export function Input({
  label,
  hint,
  error,
  className,
  ...props
}: {
  label?: string;
  hint?: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <input
        {...props}
        className={clsx(
          "w-full px-3 py-2 text-sm bg-white border rounded-lg outline-none transition",
          error
            ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-300"
            : "border-gray-200 focus:border-green focus:ring-1 focus:ring-green/30"
        )}
      />
      {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ── Select ───────────────────────────────────────────────────────────
export function Select({
  label,
  children,
  className,
  ...props
}: {
  label?: string;
  children: ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <select
        {...props}
        className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition appearance-none"
      >
        {children}
      </select>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/25 backdrop-blur-[2px]">
      <div className={clsx("bg-white rounded-card shadow-modal w-full my-8", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-card">{footer}</div>}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-xs mb-5">{description}</p>
      {action}
    </div>
  );
}

// ── Table primitives ─────────────────────────────────────────────────
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-gray-200 shadow-card bg-white">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th className={clsx("px-4 py-3 text-2xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-100", right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

export function Td({ children, right, muted, className }: { children: ReactNode; right?: boolean; muted?: boolean; className?: string }) {
  return (
    <td className={clsx("px-4 py-3", right && "text-right", muted && "text-gray-400", className)}>
      {children}
    </td>
  );
}

// ── Alert ────────────────────────────────────────────────────────────
export function Alert({ children, variant = "error" }: { children: ReactNode; variant?: "error" | "info" | "success" }) {
  const styles = {
    error: "bg-red-50 border-red-100 text-red-600",
    info: "bg-blue-50 border-blue-100 text-blue-700",
    success: "bg-green-light border-green/20 text-green-dark",
  };
  return (
    <div className={clsx("text-sm border rounded-lg px-3 py-2.5", styles[variant])}>
      {children}
    </div>
  );
}
