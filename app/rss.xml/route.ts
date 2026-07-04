import { siteConfig } from "@/config/site";
import { getAllPosts } from "@/lib/blog";

// Prerender at build time — the feed only changes when posts change.
export const dynamic = "force-static";

const FEED_URL = `${siteConfig.url}/rss.xml`;
const BLOG_URL = `${siteConfig.url}/blog`;

/** Escape the five XML-significant characters for text nodes. */
function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/** RFC-822 date, required by the RSS 2.0 spec for pubDate/lastBuildDate. */
function rfc822(date: string): string {
    return new Date(`${date}T00:00:00Z`).toUTCString();
}

export function GET(): Response {
    const posts = getAllPosts();

    const items = posts
        .map((post) => {
            const url = `${siteConfig.url}/blog/${post.slug}`;

            return `        <item>
            <title>${escapeXml(post.title)}</title>
            <link>${url}</link>
            <guid isPermaLink="true">${url}</guid>
            <pubDate>${rfc822(post.date)}</pubDate>
            <description>${escapeXml(post.summary)}</description>
        </item>`;
        })
        .join("\n");

    const lastBuildDate = posts[0]
        ? rfc822(posts[0].date)
        : new Date().toUTCString();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>${escapeXml(siteConfig.name)} — Blog</title>
        <link>${BLOG_URL}</link>
        <description>Notes on software engineering, web performance, and system design.</description>
        <language>en-IN</language>
        <lastBuildDate>${lastBuildDate}</lastBuildDate>
        <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />
${items}
    </channel>
</rss>`;

    return new Response(xml, {
        headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
        },
    });
}
