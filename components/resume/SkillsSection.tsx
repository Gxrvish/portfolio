import { Section } from "@/components/resume/Section";
import type { SkillCategory } from "@/types/resume";

type SkillsSectionProps = {
    skills: SkillCategory[];
};

export function SkillsSection({ skills }: SkillsSectionProps) {
    return (
        <Section id="skills" title="Skills">
            <div className="skill-list">
                {skills.map((group) => (
                    <div key={group.title} className="skill-row">
                        <span className="skill-label">{group.title}</span>
                        <ul className="skill-values" aria-label={group.title}>
                            {group.values.map((skill) => (
                                <li
                                    key={`${group.title}-${skill}`}
                                    className="chip"
                                >
                                    {skill}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </Section>
    );
}
