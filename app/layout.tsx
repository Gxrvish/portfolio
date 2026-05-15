import "./globals.css";

import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import Script from "next/script";

import { BootScreen } from "@/components/resume/BootScreen";
import { ThemeProvider } from "@/components/resume/ThemeProvider";
import { siteConfig } from "@/config/site";

const bodyFont = Manrope({
    variable: "--font-body",
    subsets: ["latin"],
    display: "swap",
});

const monoFont = JetBrains_Mono({
    variable: "--font-mono",
    subsets: ["latin"],
    display: "swap",
});

const themeInitScript = `
(() => {
    try {
        const storedTheme = window.localStorage.getItem("theme");
        const theme =
            storedTheme === "dark" || storedTheme === "light"
                ? storedTheme
                : window.matchMedia("(prefers-color-scheme: dark)").matches
                  ? "dark"
                  : "light";

        document.documentElement.setAttribute("data-theme", theme);
    } catch {
        document.documentElement.setAttribute("data-theme", "light");
    }
})();
`;

const scrollInitScript = `
(() => {
    try {
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual";
        }

        const key = "scroll:" + window.location.pathname + window.location.search;
        const navEntry = performance.getEntriesByType("navigation")[0];
        const isReload = navEntry && navEntry.type === "reload";

        const saveScrollPosition = () => {
            window.sessionStorage.setItem(key, String(window.scrollY || 0));
        };

        window.addEventListener("beforeunload", saveScrollPosition);
        window.addEventListener("pagehide", saveScrollPosition);

        if (isReload) {
            const saved = window.sessionStorage.getItem(key);
            const savedY = saved ? Number(saved) : 0;

            if (Number.isFinite(savedY)) {
                const restore = () => window.scrollTo(0, savedY);
                restore();
                requestAnimationFrame(restore);
                window.addEventListener("load", restore, { once: true });
            } else {
                window.scrollTo(0, 0);
            }
        } else {
            window.sessionStorage.removeItem(key);
            window.scrollTo(0, 0);
        }
    } catch {
        window.scrollTo(0, 0);
    }
})();
`;

export const metadata: Metadata = {
    metadataBase: new URL(siteConfig.url),
    title: {
        default: siteConfig.title,
        template: "%s | Garvish Panchal",
    },
    description: siteConfig.description,
    alternates: {
        canonical: "/",
    },
    keywords: [
        "Garvish Panchal",
        "Software Engineer",
        "Portfolio",
        "Resume",
        "Next.js",
        "TypeScript",
        "Web Performance",
    ],
    authors: [{ name: siteConfig.name, url: siteConfig.url }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    category: "technology",
    openGraph: {
        type: "website",
        locale: siteConfig.locale,
        title: siteConfig.title,
        description: siteConfig.description,
        url: siteConfig.url,
        siteName: `${siteConfig.name} Portfolio`,
        images: [
            {
                url: "/opengraph-image",
                width: 1200,
                height: 630,
                alt: "Garvish Panchal Software Engineer Portfolio",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: siteConfig.title,
        description: siteConfig.description,
        images: ["/opengraph-image"],
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
        },
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: [
        { media: "(prefers-color-scheme: dark)", color: "#060a0f" },
        { media: "(prefers-color-scheme: light)", color: "#eef2ec" },
    ],
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            suppressHydrationWarning
            className={`${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col">
                <Script id="theme-init" strategy="beforeInteractive">
                    {themeInitScript}
                </Script>
                <Script id="scroll-init" strategy="beforeInteractive">
                    {scrollInitScript}
                </Script>
                <BootScreen />
                <ThemeProvider>{children}</ThemeProvider>
            </body>
        </html>
    );
}
