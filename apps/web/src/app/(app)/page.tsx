import { IconCirclePlus, IconCompass } from "@tabler/icons-react";
import { currentUser } from "@/server/session";
import { ButtonLink } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/StateMessage";

// Discover arrives in T29 and T30, and the landing page (S01) in T19. Until then, someone signed in sees
// the shell around Discover's empty state, whose words are true while no activities exist.
export default async function Home() {
  if (!(await currentUser())) return <h1>curio</h1>;
  return (
    <EmptyState
      icon={<IconCompass aria-hidden="true" />}
      title="Nothing on near you yet"
      action={
        <ButtonLink href="/create" icon={<IconCirclePlus aria-hidden="true" />}>
          Create one
        </ButtonLink>
      }
    />
  );
}
