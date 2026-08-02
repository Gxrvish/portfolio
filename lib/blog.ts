import fs from "node:fs";
import path from "node:path";

import type { BlogFrontmatter, BlogPost, BlogPostMeta } from "@/types/blog";

const POSTS_DIR = path.join(process.cwd(), "content", "blog");

const WORDS_PER_MINUTE = 220;

/**
 * Resolve a post's metadata + body. Prefers a YAML frontmatter block, but
 * gracefully derives title/date/summary from the Markdown itself when the
 * block is missing — so dropping in a raw `.md` file never breaks the build.
 */
function extractMeta(
    raw: string,
    filePath: string
): { data: BlogFrontmatter; content: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);

    if (match) {
        const [, block, body] = match;
        const fm = parseBlock(block);
        const date = fm.date || fileDate(filePath);

        return {
            data: {
                title: fm.title || deriveTitle(body) || "Untitled",
                date,
                updated: fm.updated || date,
                summary: fm.summary || deriveSummary(body),
                tags: fm.tags,
                series: fm.series,
                order: fm.order,
            },
            content: stripLeadingH1(body.trim()),
        };
    }

    const date = fileDate(filePath);

    return {
        data: {
            title: deriveTitle(raw) || "Untitled",
            date,
            updated: date,
            summary: deriveSummary(raw),
            tags: [],
            series: "",
            order: 0,
        },
        content: stripLeadingH1(raw.trim()),
    };
}

function parseBlock(block: string): BlogFrontmatter {
    const data: Record<string, string | string[]> = {};

    for (const line of block.split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith("#")) {
            continue;
        }

        const sep = line.indexOf(":");
        if (sep === -1) {
            continue;
        }

        const key = line.slice(0, sep).trim();
        const value = line.slice(sep + 1).trim();

        if (value.startsWith("[") && value.endsWith("]")) {
            data[key] = value
                .slice(1, -1)
                .split(",")
                .map((item) => unquote(item.trim()))
                .filter(Boolean);
        } else {
            data[key] = unquote(value);
        }
    }

    const order = Number.parseInt(asString(data.order), 10);

    return {
        title: asString(data.title),
        date: asString(data.date),
        updated: asString(data.updated),
        summary: asString(data.summary),
        tags: Array.isArray(data.tags) ? data.tags : [],
        series: asString(data.series),
        order: Number.isNaN(order) ? 0 : order,
    };
}

function unquote(value: string): string {
    return value.replace(/^["']/, "").replace(/["']$/, "");
}

function asString(value: string | string[] | undefined): string {
    return typeof value === "string" ? value : "";
}

function deriveTitle(body: string): string {
    const heading = /^#\s+(.+)$/m.exec(body);
    return heading ? heading[1].trim() : "";
}

/** First prose block after the title, stripped of Markdown markers. */
function deriveSummary(body: string): string {
    const lines = body.split(/\r?\n/);
    const buffer: string[] = [];
    let started = false;

    for (const line of lines) {
        const text = line.trim();

        if (!text) {
            if (started) {
                break;
            }
            continue;
        }

        if (/^#{1,6}\s/.test(text) || text === "---") {
            continue;
        }

        started = true;
        buffer.push(text.replace(/^>\s?/, "").replace(/[*_`#]/g, ""));
    }

    const summary = buffer.join(" ").replace(/\s+/g, " ").trim();
    return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
}

/** Remove a leading H1 so it doesn't duplicate the rendered article title. */
function stripLeadingH1(content: string): string {
    return content.replace(/^#\s+.+(\r?\n)+/, "");
}

function fileDate(filePath: string): string {
    return fs.statSync(filePath).mtime.toISOString().slice(0, 10);
}

function readingTime(content: string): number {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

const ignoreList: string[] = [];

function postFiles(): string[] {
    if (!fs.existsSync(POSTS_DIR)) {
        return [];
    }

    return fs
        .readdirSync(POSTS_DIR)
        .filter(
            (file) =>
                file.endsWith(".md") &&
                !file.startsWith("_") &&
                !ignoreList.includes(file)
        );
}

export function getAllPosts(): BlogPostMeta[] {
    return postFiles()
        .map((file) => {
            const slug = file.replace(/\.md$/, "");
            const filePath = path.join(POSTS_DIR, file);
            const raw = fs.readFileSync(filePath, "utf8");
            const { data, content } = extractMeta(raw, filePath);

            return {
                ...data,
                slug,
                readingTime: readingTime(content),
            };
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string): BlogPost | null {
    const filePath = path.join(POSTS_DIR, `${slug}.md`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const { data, content } = extractMeta(raw, filePath);

    return {
        ...data,
        slug,
        readingTime: readingTime(content),
        content,
    };
}

export function getAllSlugs(): string[] {
    return postFiles().map((file) => file.replace(/\.md$/, ""));
}

/**
 * All posts of a series in reading order (hub first, then parts ascending).
 * Returns an empty list for a standalone post.
 */
export function getSeries(series: string): BlogPostMeta[] {
    if (!series) {
        return [];
    }

    return getAllPosts()
        .filter((post) => post.series === series)
        .sort((a, b) => a.order - b.order);
}
