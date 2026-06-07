"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/ThemeToggle";
import { siteConfig } from "@/config/site";

const LINKS = [
    { href: "/", label: "Home" },
    { href: "/blog", label: "Blog" },
];

export function SiteNav() {
    const pathname = usePathname();

    const isActive = (href: string) =>
        href === "/" ? pathname === "/" : pathname.startsWith(href);

    return (
        <nav className="site-nav" aria-label="Primary">
            <div className="container site-nav-inner">
                <Link href="/" className="nav-brand">
                    {siteConfig.name}
                </Link>
                <div className="nav-links">
                    {LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="nav-item"
                            aria-current={
                                isActive(link.href) ? "page" : undefined
                            }
                        >
                            {link.label}
                        </Link>
                    ))}
                    <ThemeToggle />
                </div>
            </div>
        </nav>
    );
}
