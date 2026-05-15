import { Section } from "@/components/resume/Section";
import type { SkillCategory } from "@/types/resume";

type SkillsSectionProps = {
    skills: SkillCategory[];
};

export function SkillsSection({ skills }: SkillsSectionProps) {
    return (
        <Section id="skills" title="Skills" command="ls -la skills/">
            <div className="skill-grid">
                {skills.map((group) => (
                    <article key={group.title} className="skill-card">
                        <h3 className="skill-title">{group.title}</h3>
                        <ul className="chip-list" aria-label={group.title}>
                            {group.values.map((skill) => (
                                <li
                                    key={`${group.title}-${skill}`}
                                    className="chip"
                                >
                                    {skill}
                                </li>
                            ))}
                        </ul>
                    </article>
                ))}
            </div>
        </Section>
    );
}
