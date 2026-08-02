import { ImageResponse } from "next/og";

import { siteConfig } from "@/config/site";
import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { formatDate } from "@/lib/format";

export const alt = "Blog post";

export const size = {
    width: 1200,
    height: 630,
};

export const contentType = "image/png";

// Prerender one card per post at build time instead of on first request.
export function generateStaticParams() {
    return getAllSlugs().map((slug) => ({ slug }));
}

/**
 * Rough line-length budget so long titles step down a size instead of
 * overflowing the card. Satori has no text measurement API, so this is
 * character-count based rather than exact.
 */
function titleSize(title: string): number {
    if (title.length > 78) {
        return 54;
    }
    if (title.length > 48) {
        return 66;
    }
    return 80;
}

type Props = {
    params: Promise<{ slug: string }>;
};

export default async function BlogOpenGraphImage({ params }: Props) {
    const { slug } = await params;
    const post = getPostBySlug(slug);

    const title = post?.title ?? "Blog";
    const meta = post
        ? [
              formatDate(post.date),
              `${post.readingTime} min read`,
              post.series && post.order > 0
                  ? `Part ${post.order} · ${post.series}`
                  : null,
          ]
              .filter(Boolean)
              .join("  ·  ")
        : siteConfig.role;

    return new ImageResponse(
        <div
            style={{
                height: "100%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "72px",
                background: "#0a0a0a",
                color: "#ededed",
                fontFamily: "sans-serif",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    fontSize: 26,
                    color: "#8b8b8b",
                }}
            >
                <div
                    style={{
                        width: 14,
                        height: 14,
                        borderRadius: 9999,
                        background: "#60a5fa",
                    }}
                />
                {siteConfig.url.replace("https://", "")}/blog
            </div>

            <div
                style={{
                    display: "flex",
                    fontSize: titleSize(title),
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.1,
                }}
            >
                {title}
            </div>

            <div
                style={{
                    display: "flex",
                    fontSize: 28,
                    color: "#8b8b8b",
                }}
            >
                {meta}
            </div>
        </div>,
        size
    );
}
