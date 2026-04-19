import { ThemeToggle } from "@/components/resume/ThemeToggle";
import type { NavItem, ResumeProfile } from "@/types/resume";

type HeaderSectionProps = {
    profile: ResumeProfile;
    navItems: NavItem[];
};

const getPhoneHref = (phone: string) => `tel:${phone.replace(/\s+/g, "")}`;

export function HeaderSection({ profile, navItems }: HeaderSectionProps) {
    return (
        <header className="hero-card" aria-labelledby="profile-name">
            <div className="hero-top-row">
                <p className="title-eyebrow">{profile.role}</p>
                <ThemeToggle />
            </div>
            <h1 id="profile-name" className="hero-title">
                {profile.name}
            </h1>
            <p className="hero-tagline">{profile.tagline}</p>

            <address className="contact-row">
                <a className="contact-link" href={getPhoneHref(profile.phone)}>
                    {profile.phone}
                </a>
                <a className="contact-link" href={`mailto:${profile.email}`}>
                    {profile.email}
                </a>
                <a
                    className="contact-link"
                    href={profile.linkedin.href}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {profile.linkedin.display}
                </a>
                <span className="location-pill">{profile.location}</span>
            </address>

            <nav className="quick-nav" aria-label="Resume sections">
                {navItems.map((item) => (
                    <a key={item.id} className="nav-link" href={`#${item.id}`}>
                        {item.label}
                    </a>
                ))}
            </nav>
        </header>
    );
}
