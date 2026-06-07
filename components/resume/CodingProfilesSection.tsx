import { Section } from "@/components/resume/Section";
import type { ExternalLink } from "@/types/resume";

type CodingProfilesSectionProps = {
    profiles: ExternalLink[];
};

export function CodingProfilesSection({
    profiles,
}: CodingProfilesSectionProps) {
    return (
        <Section id="coding-profiles" title="Coding Profiles">
            <div className="profiles">
                {profiles.map((profile) => (
                    <a
                        key={profile.label}
                        href={profile.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="profile-link"
                    >
                        {profile.label}
                    </a>
                ))}
            </div>
        </Section>
    );
}
