import type { ReactNode } from "react";

type SectionProps = {
    id: string;
    title: string;
    children: ReactNode;
    intro?: string;
};

export function Section({ id, title, intro, children }: SectionProps) {
    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="section-card"
        >
            <div className="section-head">
                <h2 id={`${id}-heading`} className="section-title">
                    {title}
                </h2>
                {intro ? <p className="section-intro">{intro}</p> : null}
            </div>
            {children}
        </section>
    );
}
