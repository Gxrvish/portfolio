import type { ReactNode } from "react";

type SectionProps = {
    id: string;
    title: string;
    children: ReactNode;
};

export function Section({ id, title, children }: SectionProps) {
    return (
        <section id={id} aria-labelledby={`${id}-heading`} className="section">
            <h2 id={`${id}-heading`} className="section-title">
                {title}
            </h2>
            {children}
        </section>
    );
}
