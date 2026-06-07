import { Section } from "@/components/resume/Section";
import type { ResumeEducation } from "@/types/resume";

type EducationSectionProps = {
    education: ResumeEducation[];
};

export function EducationSection({ education }: EducationSectionProps) {
    return (
        <Section id="education" title="Education">
            <div className="entries">
                {education.map((item) => (
                    <article key={item.degree}>
                        <div className="entry-head">
                            <h3 className="entry-title">{item.degree}</h3>
                            <p className="entry-period">{item.graduation}</p>
                        </div>
                        <p className="entry-meta">{item.institution}</p>
                        <p className="entry-score">{item.score}</p>
                    </article>
                ))}
            </div>
        </Section>
    );
}
