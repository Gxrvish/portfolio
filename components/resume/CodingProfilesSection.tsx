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
            <div className="profile-grid">
                {profiles.map((profile) => (
                    <a
                        key={profile.label}
                        href={profile.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="profile-link"
                    >
                        <span className="profile-label">{profile.label}</span>
                        <span className="profile-url">{profile.display}</span>
                    </a>
                ))}
            </div>
        </Section>
    );
}
