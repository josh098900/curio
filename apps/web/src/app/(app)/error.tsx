"use client";

import { IconExclamationCircle, IconRefresh } from "@tabler/icons-react";
import { SystemPage } from "@/shared/shell/SystemPage";
import { Button } from "@/shared/ui/Button";
import { ErrorState } from "@/shared/ui/StateMessage";

/**
 * S54 Something went wrong, with the frame's words, inside the (app) group's shell when someone is
 * signed in. The words are the frame's page copy rather than UNAVAILABLE's one-line message
 * (decided on 15 November); inline errors use the contract's.
 * Next's own error page styles itself inline, which the CSP refuses (T14). T16 reports the error
 * to Sentry; the "joining paused" banner is T52's.
 */
export default function SomethingWentWrong({ reset }: { reset: () => void }) {
  return (
    <SystemPage>
      <ErrorState
        icon={<IconExclamationCircle aria-hidden="true" />}
        title="Something went wrong"
        action={
          <Button icon={<IconRefresh aria-hidden="true" />} onClick={reset}>
            Try again
          </Button>
        }
      >
        Please try again later. It&apos;s not something you did.
      </ErrorState>
    </SystemPage>
  );
}
