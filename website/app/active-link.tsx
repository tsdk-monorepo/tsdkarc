"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
};

export default function NavLink({
  href,
  children,
  className = "",
  activeClassName = "active",
}: NavLinkProps) {
  const pathname = usePathname();

  const isActive = pathname === href;

  const combinedClass = [className, isActive ? activeClassName : null]
    .filter(Boolean)
    .join(" ");

  return (
    <Link href={href} className={combinedClass}>
      {children}
    </Link>
  );
}
