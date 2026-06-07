import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";
import { getAllPosts } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
    const posts = getAllPosts();

    const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
        url: `${siteConfig.url}/blog/${post.slug}`,
        lastModified: new Date(`${post.date}T00:00:00`),
        changeFrequency: "yearly",
        priority: 0.6,
    }));

    return [
        {
            url: siteConfig.url,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 1,
        },
        {
            url: `${siteConfig.url}/blog`,
            lastModified: posts[0]
                ? new Date(`${posts[0].date}T00:00:00`)
                : new Date(),
            changeFrequency: "weekly",
            priority: 0.8,
        },
        ...postEntries,
    ];
}
