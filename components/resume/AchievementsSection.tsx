import { Section } from "@/components/resume/Section";
import type { ResumeAchievement } from "@/types/resume";

type AchievementsSectionProps = {
    achievements: ResumeAchievement[];
};

export function AchievementsSection({
    achievements,
}: AchievementsSectionProps) {
    return (
        <Section id="achievements" title="Achievements">
            <ul className="bullets">
                {achievements.map((achievement) => (
                    <li key={achievement.text}>
                        {achievement.text}
                        {achievement.reference ? (
                            <>
                                {" "}
                                <a
                                    href={achievement.reference.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-link"
                                >
                                    ({achievement.reference.label})
                                </a>
                            </>
                        ) : null}
                    </li>
                ))}
            </ul>
        </Section>
    );
}
