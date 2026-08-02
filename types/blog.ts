export type BlogFrontmatter = {
    title: string;
    date: string;
    /** Last substantive edit. Falls back to `date` when absent. */
    updated: string;
    summary: string;
    tags: string[];
    /** Name of the series this post belongs to, if any. */
    series: string;
    /** Position within `series`. 0 is the hub/pillar post. */
    order: number;
};

export type BlogPostMeta = BlogFrontmatter & {
    slug: string;
    readingTime: number;
};

export type BlogPost = BlogPostMeta & {
    content: string;
};
