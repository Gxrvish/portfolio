import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
    return (
        <div className="prose">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSlug]}
                components={{
                    // `node` is react-markdown's hast node. It must be pulled
                    // out of every override, or React serializes it onto the
                    // element as node="[object Object]" — a few hundred bytes
                    // of junk markup on a long post.
                    code: ({ node, className, children, ...props }) => {
                        void node;
                        const text = String(children);
                        const isBlock = text.includes("\n");
                        const isDiagram =
                            isBlock && !className && /[─-╿←-⇿■-◿]/.test(text);
                        return (
                            <code
                                className={isDiagram ? "diagram" : className}
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },
                    table: ({ node, children, ...props }) => {
                        void node;
                        return (
                            <div className="table-wrap">
                                <table {...props}>{children}</table>
                            </div>
                        );
                    },
                    a: ({ node, href, children, ...props }) => {
                        void node;
                        const external = href?.startsWith("http");
                        return (
                            <a
                                href={href}
                                {...(external
                                    ? {
                                          target: "_blank",
                                          rel: "noopener noreferrer",
                                      }
                                    : {})}
                                {...props}
                            >
                                {children}
                            </a>
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
