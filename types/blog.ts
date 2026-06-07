export type BlogFrontmatter = {
    title: string;
    date: string;
    summary: string;
    tags: string[];
};

export type BlogPostMeta = BlogFrontmatter & {
    slug: string;
    readingTime: number;
};

export type BlogPost = BlogPostMeta & {
    content: string;
};
