import "./globals.css";

import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";

import { ThemeProvider } from "@/components/resume/ThemeProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
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
        { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
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
            <head>
                {/* Must run render-blocking before paint to apply the theme
                    without a flash, so a synchronous script is intentional. */}
                {/* eslint-disable-next-line @next/next/no-sync-scripts */}
                <script src="/head-init.js" />
            </head>
            <body className="min-h-full flex flex-col">
                <ThemeProvider>
                    <SiteNav />
                    {children}
                    <SiteFooter />
                </ThemeProvider>
            </body>
        </html>
    );
}
