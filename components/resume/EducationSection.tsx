import { Section } from "@/components/resume/Section";
import type { ResumeEducation } from "@/types/resume";

type EducationSectionProps = {
    education: ResumeEducation[];
};

export function EducationSection({ education }: EducationSectionProps) {
    return (
        <Section id="education" title="Education">
            <div className="stack-list">
                {education.map((item) => (
                    <article key={item.degree} className="entry-card">
                        <header className="entry-head">
                            <h3 className="entry-title">{item.degree}</h3>
                            <p className="entry-period">
                                Graduated: {item.graduation}
                            </p>
                        </header>
                        <p className="entry-meta">{item.institution}</p>
                        <p className="entry-score">{item.score}</p>
                    </article>
                ))}
            </div>
        </Section>
    );
}
