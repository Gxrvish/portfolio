import { Section } from "@/components/resume/Section";
import type { ResumeExperience } from "@/types/resume";

type ExperienceSectionProps = {
    experiences: ResumeExperience[];
};

export function ExperienceSection({ experiences }: ExperienceSectionProps) {
    return (
        <Section id="experience" title="Experience">
            <div className="entries">
                {experiences.map((experience) => (
                    <article key={`${experience.company}-${experience.role}`}>
                        <div className="entry-head">
                            <h3 className="entry-title">
                                {experience.role}
                                <span className="entry-sub">
                                    {" "}
                                    · {experience.company}
                                </span>
                            </h3>
                            <p className="entry-period">{experience.period}</p>
                        </div>

                        <p className="entry-meta">
                            {experience.location} ·{" "}
                            {experience.stack.join(", ")}
                        </p>

                        <ul className="bullets">
                            {experience.highlights.map((highlight) => (
                                <li key={highlight}>{highlight}</li>
                            ))}
                        </ul>
                    </article>
                ))}
            </div>
        </Section>
    );
}
