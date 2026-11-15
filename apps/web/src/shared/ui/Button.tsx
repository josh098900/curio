import { Link } from "./Link";
import type { ComponentProps, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "destructive" | "text";

type Look = {
  /** One primary button per screen; everything else is outlined or plain text (brief §3). */
  variant?: Variant;
  /** An icon goes beside the words, never instead of them. */
  icon?: ReactNode;
  /** Full width, as on S56. */
  wide?: boolean;
  children: ReactNode;
};

function classes(variant: Variant, wide?: boolean) {
  return [styles.button, styles[variant], wide && styles.wide]
    .filter(Boolean)
    .join(" ");
}

/** A button. */
export function Button({
  variant = "primary",
  icon,
  wide,
  children,
  ...props
}: Look & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type="button" {...props} className={classes(variant, wide)}>
      {icon}
      {children}
    </button>
  );
}

/** A link that looks like a button, for actions that go somewhere. */
export function ButtonLink({
  variant = "primary",
  icon,
  wide,
  children,
  href,
}: Look & { href: string }) {
  return (
    <Link href={href} className={classes(variant, wide)}>
      {icon}
      {children}
    </Link>
  );
}
