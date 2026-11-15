import { ShellIfSignedIn } from "../frame";

/**
 * Pages with the tab bar and top bar for someone signed in. A signed-in page without them (S07,
 * S08, S10, S18, S20…) lives outside this group, under a layout of its own.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <ShellIfSignedIn>{children}</ShellIfSignedIn>;
}
