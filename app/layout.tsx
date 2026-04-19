import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";

import { siteConfig } from "@/config/site";

const bodyFont = Manrope({
    variable: "--font-body",
    subsets: ["latin"],
    display: "swap",
});

const headingFont = Fraunces({
    variable: "--font-heading",
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
    themeColor: "#0f766e",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${bodyFont.variable} ${headingFont.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col">{children}</body>
        </html>
    );
}
