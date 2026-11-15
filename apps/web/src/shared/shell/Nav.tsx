"use client";

import {
  IconBell,
  IconCalendar,
  IconCirclePlus,
  IconCompass,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Nav.module.css";
import { Wordmark } from "./Wordmark";

/** The four destinations, the same on phones, on desktop and in the iOS app (spec §16). */
const destinations = [
  { href: "/", label: "Discover", Icon: IconCompass },
  { href: "/create", label: "Create", Icon: IconCirclePlus },
  { href: "/plans", label: "Plans", Icon: IconCalendar },
  { href: "/profile", label: "Profile", Icon: IconUser },
];

function isCurrent(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** The destinations, each an icon with its word; the current one is marked for screen readers. */
function Destinations({ className }: { className: string }) {
  const pathname = usePathname();
  return (
    <ul className={className}>
      {destinations.map(({ href, label, Icon }) => (
        <li key={href}>
          <Link
            href={href}
            aria-current={isCurrent(pathname, href) ? "page" : undefined}
            className={styles.link}
          >
            <Icon aria-hidden="true" className={styles.icon} />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Desktop: the wordmark, the four destinations and the notifications bell (brief §4). */
export function TopNav() {
  return (
    <header className={styles.top}>
      <Wordmark />
      <nav aria-label="Main">
        <Destinations className={styles.topList} />
      </nav>
      <Link href="/notifications" className={styles.bell}>
        <IconBell aria-hidden="true" />
        <span className="visually-hidden">Notifications</span>
      </Link>
    </header>
  );
}

/** Phones: the bottom tab bar (brief §4). */
export function BottomNav() {
  return (
    <nav aria-label="Main" className={styles.bottom}>
      <Destinations className={styles.bottomList} />
    </nav>
  );
}
