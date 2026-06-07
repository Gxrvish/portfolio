import type { ResumeProfile } from "@/types/resume";

type HeaderSectionProps = {
    profile: ResumeProfile;
};

const getPhoneHref = (phone: string) => `tel:${phone.replace(/\s+/g, "")}`;

export function HeaderSection({ profile }: HeaderSectionProps) {
    return (
        <header className="hero">
            <h1 id="profile-name" className="hero-name">
                {profile.name}
            </h1>
            <p className="hero-role">{profile.role}</p>
            <p className="hero-tagline">{profile.tagline}</p>

            <address className="hero-contact">
                <a href={`mailto:${profile.email}`}>{profile.email}</a>
                <a href={getPhoneHref(profile.phone)}>{profile.phone}</a>
                <a
                    href={profile.linkedin.href}
                    target="_blank"
                    rel="noopener noreferrer me"
                >
                    {profile.linkedin.display}
                </a>
                <span className="loc">{profile.location}</span>
            </address>
        </header>
    );
}
