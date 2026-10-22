import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <p className="text-[13px] font-semibold tracking-[0.1em] text-muted uppercase">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This road doesn&apos;t go anywhere</h1>
      <p className="mt-2 text-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
        Find a ride
      </Link>
    </div>
  );
}
