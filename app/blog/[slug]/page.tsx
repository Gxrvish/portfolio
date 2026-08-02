import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Markdown } from "@/components/Markdown";
import { siteConfig } from "@/config/site";
import { getAllSlugs, getPostBySlug, getSeries } from "@/lib/blog";
import { formatDate } from "@/lib/format";

type PageProps = {
    params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
    return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
    params,
}: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const post = getPostBySlug(slug);

    if (!post) {
        return { title: "Post not found" };
    }

    const url = `${siteConfig.url}/blog/${post.slug}`;

    return {
        title: post.title,
        description: post.summary,
        keywords: post.tags,
        alternates: {
            canonical: `/blog/${post.slug}`,
        },
        openGraph: {
            title: post.title,
            description: post.summary,
            url,
            type: "article",
            publishedTime: post.date,
            modifiedTime: post.updated,
            authors: [siteConfig.name],
            tags: post.tags,
        },
        twitter: {
            card: "summary_large_image",
            title: post.title,
            description: post.summary,
        },
    };
}

export default async function BlogPostPage({ params }: PageProps) {
    const { slug } = await params;
    const post = getPostBySlug(slug);

    if (!post) {
        notFound();
    }

    const url = `${siteConfig.url}/blog/${post.slug}`;

    // Sibling posts, so a series reads as one work to both crawlers and humans.
    const series = getSeries(post.series);
    const seriesIndex = series.findIndex((entry) => entry.slug === post.slug);
    const hub = series[0];
    const previous = seriesIndex > 0 ? series[seriesIndex - 1] : null;
    const next = seriesIndex >= 0 ? (series[seriesIndex + 1] ?? null) : null;

    const structuredData = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "@id": `${url}#post`,
        headline: post.title,
        description: post.summary,
        datePublished: post.date,
        dateModified: post.updated,
        keywords: post.tags.join(", "),
        wordCount: post.content.trim().split(/\s+/).filter(Boolean).length,
        inLanguage: "en-IN",
        url,
        mainEntityOfPage: {
            "@type": "WebPage",
            "@id": url,
        },
        author: {
            "@type": "Person",
            name: siteConfig.name,
            url: siteConfig.url,
            sameAs: Object.values(siteConfig.socials),
        },
        publisher: {
            "@type": "Person",
            name: siteConfig.name,
            url: siteConfig.url,
        },
        ...(post.series && hub
            ? {
                  isPartOf: {
                      "@type": "CreativeWorkSeries",
                      name: post.series,
                      url: `${siteConfig.url}/blog/${hub.slug}`,
                  },
                  position: post.order,
              }
            : {}),
    };

    const breadcrumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: siteConfig.url,
            },
            {
                "@type": "ListItem",
                position: 2,
                name: "Blog",
                item: `${siteConfig.url}/blog`,
            },
            { "@type": "ListItem", position: 3, name: post.title, item: url },
        ],
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(structuredData),
                }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(breadcrumbs),
                }}
            />
            <a className="skip-link" href="#content">
                Skip to content
            </a>
            <main id="content" className="container page">
                <Link href="/blog" className="back-link">
                    ← Back to blog
                </Link>

                <article>
                    <header className="article-header">
                        <span className="article-meta">
                            {formatDate(post.date)} · {post.readingTime} min
                            read
                            {post.series && seriesIndex > 0
                                ? ` · Part ${post.order} of ${series.length - 1}`
                                : null}
                        </span>
                        <h1 className="article-title">{post.title}</h1>
                    </header>

                    <Markdown content={post.content} />
                </article>

                {previous || next ? (
                    <nav className="series-nav" aria-label="Series navigation">
                        {previous ? (
                            <Link href={`/blog/${previous.slug}`} rel="prev">
                                ← {previous.title}
                            </Link>
                        ) : (
                            <span />
                        )}
                        {next ? (
                            <Link href={`/blog/${next.slug}`} rel="next">
                                {next.title} →
                            </Link>
                        ) : (
                            <span />
                        )}
                    </nav>
                ) : null}
            </main>
        </>
    );
}
