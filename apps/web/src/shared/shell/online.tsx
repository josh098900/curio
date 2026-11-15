"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { Banner } from "../ui/Banner";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Whether the device is online. The server assumes it is. Join reads this too (T34). */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * S55: the notice while the device is offline. Nothing waits to be sent later, so it says what
 * needs a connection (spec §14.4, differences.md row 18). Its live region is always on the page,
 * so the notice is announced when it appears.
 */
export function OfflineNotice({ className }: { className?: string }) {
  const online = useOnline();
  return (
    <div aria-live="polite" className={className}>
      {!online && (
        <Banner tone="warning" icon={IconWifiOff} title="You're offline.">
          What&apos;s loaded stays readable. Joining, messages and changes need
          a connection.
        </Banner>
      )}
    </div>
  );
}
