import type { ReactNode } from "react";

type SectionProps = {
    id: string;
    title: string;
    command: string;
    children: ReactNode;
    intro?: string;
};

export function Section({ id, title, command, intro, children }: SectionProps) {
    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="section-card"
        >
            <div className="section-body">
                <p className="section-cmd">
                    <span className="term-prompt">
                        <span className="tp-host">visitor@garvish</span>:
                        <span className="tp-path">~/portfolio</span>${" "}
                    </span>
                    <span className="cmd-text">{command}</span>
                </p>
                <div className="section-head">
                    <h2 id={`${id}-heading`} className="section-title">
                        {title}
                    </h2>
                    {intro ? <p className="section-intro">{intro}</p> : null}
                </div>
                {children}
            </div>
        </section>
    );
}
