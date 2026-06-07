import type { Metadata } from "next";
import Link from "next/link";

import { siteConfig } from "@/config/site";
import { getAllPosts } from "@/lib/blog";
import { formatDate } from "@/lib/format";

const BLOG_DESCRIPTION =
    "Notes on software engineering, web performance, system design, and the things I build.";

export const metadata: Metadata = {
    title: "Blog",
    description: BLOG_DESCRIPTION,
    alternates: {
        canonical: "/blog",
    },
    openGraph: {
        title: `Blog | ${siteConfig.name}`,
        description: BLOG_DESCRIPTION,
        url: `${siteConfig.url}/blog`,
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: `Blog | ${siteConfig.name}`,
        description: BLOG_DESCRIPTION,
    },
};

export default function BlogIndex() {
    const posts = getAllPosts();

    const structuredData = {
        "@context": "https://schema.org",
        "@type": "Blog",
        "@id": `${siteConfig.url}/blog#blog`,
        url: `${siteConfig.url}/blog`,
        name: `${siteConfig.name} — Blog`,
        description: BLOG_DESCRIPTION,
        author: {
            "@type": "Person",
            name: siteConfig.name,
            url: siteConfig.url,
        },
        blogPost: posts.map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            description: post.summary,
            datePublished: post.date,
            keywords: post.tags.join(", "),
            url: `${siteConfig.url}/blog/${post.slug}`,
        })),
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
                <header className="blog-header">
                    <h1 className="blog-h1">Blog</h1>
                    <p className="blog-intro">{BLOG_DESCRIPTION}</p>
                </header>

                {posts.length === 0 ? (
                    <p className="empty-note">No posts yet. Check back soon.</p>
                ) : (
                    <ul className="post-list">
                        {posts.map((post) => (
                            <li key={post.slug} className="post-item">
                                <Link
                                    href={`/blog/${post.slug}`}
                                    className="post-link"
                                >
                                    <span className="post-meta">
                                        {formatDate(post.date)} ·{" "}
                                        {post.readingTime} min read
                                    </span>
                                    <h2 className="post-title">{post.title}</h2>
                                    <p className="post-summary">
                                        {post.summary}
                                    </p>
                                    {post.tags.length > 0 ? (
                                        <ul className="post-tags">
                                            {post.tags.map((tag) => (
                                                <li key={tag} className="tag">
                                                    {tag}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </main>
        </>
    );
}
