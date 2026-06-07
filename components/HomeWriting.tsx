import Link from "next/link";

import { Section } from "@/components/resume/Section";
import { formatDate } from "@/lib/format";
import type { BlogPostMeta } from "@/types/blog";

type HomeWritingProps = {
    posts: BlogPostMeta[];
};

export function HomeWriting({ posts }: HomeWritingProps) {
    if (posts.length === 0) {
        return null;
    }

    return (
        <Section id="writing" title="Writing">
            <ul className="post-list">
                {posts.map((post) => (
                    <li key={post.slug} className="post-item">
                        <Link href={`/blog/${post.slug}`} className="post-link">
                            <span className="post-meta">
                                {formatDate(post.date)}
                            </span>
                            <h3 className="post-title">{post.title}</h3>
                            <p className="post-summary">{post.summary}</p>
                        </Link>
                    </li>
                ))}
            </ul>
            <p className="entry-links" style={{ marginTop: "1.25rem" }}>
                <Link href="/blog">All posts →</Link>
            </p>
        </Section>
    );
}
