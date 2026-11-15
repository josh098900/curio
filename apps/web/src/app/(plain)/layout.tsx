import { PlainPage } from "../frame";

/** Pages without the shell, such as S56 Signed out. */
export default function PlainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlainPage>{children}</PlainPage>;
}
