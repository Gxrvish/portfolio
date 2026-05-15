import { ThemeToggle } from "@/components/resume/ThemeToggle";
import type { NavItem, ResumeProfile } from "@/types/resume";

type HeaderSectionProps = {
    profile: ResumeProfile;
    navItems: NavItem[];
};

const getPhoneHref = (phone: string) => `tel:${phone.replace(/\s+/g, "")}`;

function Prompt() {
    return (
        <span className="term-prompt">
            <span className="tp-host">visitor@garvish</span>:
            <span className="tp-path">~/portfolio</span>${" "}
        </span>
    );
}

export function HeaderSection({ profile, navItems }: HeaderSectionProps) {
    return (
        <header className="hero-card" aria-labelledby="profile-name">
            <div className="window-chrome">
                <span className="window-dots" aria-hidden="true">
                    <span className="dot dot-red" />
                    <span className="dot dot-amber" />
                    <span className="dot dot-green" />
                </span>
                <span className="window-title">
                    <b>visitor@garvish</b>: ~/portfolio — zsh
                </span>
                <ThemeToggle />
            </div>

            <div className="hero-body">
                <p className="hero-cmd">
                    <Prompt />
                    <span className="cmd-text">whoami</span>
                </p>

                <p className="title-eyebrow">{profile.role}</p>
                <h1 id="profile-name" className="hero-title">
                    <span className="accent">{profile.name}</span>
                    <span className="cursor" aria-hidden="true" />
                </h1>
                <p className="hero-tagline">{profile.tagline}</p>

                <p className="hero-cmd" style={{ marginTop: "1.4rem" }}>
                    <Prompt />
                    <span className="cmd-text">cat contact.txt</span>
                </p>
                <address className="contact-row">
                    <a
                        className="contact-link"
                        href={getPhoneHref(profile.phone)}
                    >
                        {profile.phone}
                    </a>
                    <a
                        className="contact-link"
                        href={`mailto:${profile.email}`}
                    >
                        {profile.email}
                    </a>
                    <a
                        className="contact-link"
                        href={profile.linkedin.href}
                        target="_blank"
                        rel="noopener noreferrer me"
                    >
                        {profile.linkedin.display}
                    </a>
                    <span className="location-pill">{profile.location}</span>
                </address>

                <nav className="quick-nav" aria-label="Resume sections">
                    {navItems.map((item) => (
                        <a
                            key={item.id}
                            className="nav-link"
                            href={`#${item.id}`}
                        >
                            {item.id}
                        </a>
                    ))}
                </nav>
            </div>
        </header>
    );
}
