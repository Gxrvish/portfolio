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
                    code: ({ className, children, ...props }) => {
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
                    table: ({ children, ...props }) => (
                        <div className="table-wrap">
                            <table {...props}>{children}</table>
                        </div>
                    ),
                    a: ({ href, children, ...props }) => {
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
