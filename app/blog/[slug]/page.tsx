import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Markdown } from "@/components/Markdown";
import { siteConfig } from "@/config/site";
import { getAllSlugs, getPostBySlug } from "@/lib/blog";
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

    const structuredData = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "@id": `${url}#post`,
        headline: post.title,
        description: post.summary,
        datePublished: post.date,
        dateModified: post.date,
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
        },
        publisher: {
            "@type": "Person",
            name: siteConfig.name,
            url: siteConfig.url,
        },
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(structuredData),
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
                        </span>
                        <h1 className="article-title">{post.title}</h1>
                    </header>

                    <Markdown content={post.content} />
                </article>
            </main>
        </>
    );
}
