import { Section } from "@/components/resume/Section";
import type { ResumeExperience } from "@/types/resume";

type ExperienceSectionProps = {
    experiences: ResumeExperience[];
};

export function ExperienceSection({ experiences }: ExperienceSectionProps) {
    return (
        <Section id="experience" title="Experience">
            <div className="stack-list">
                {experiences.map((experience) => (
                    <article
                        key={`${experience.company}-${experience.role}`}
                        className="entry-card"
                    >
                        <header className="entry-head">
                            <h3 className="entry-title">
                                {experience.role}
                                <span className="entry-company">
                                    {" "}
                                    @ {experience.company}
                                </span>
                            </h3>
                            <p className="entry-period">{experience.period}</p>
                        </header>

                        <p className="entry-meta">
                            {experience.location} |{" "}
                            {experience.stack.join(", ")}
                        </p>

                        <ul className="bullet-list">
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
