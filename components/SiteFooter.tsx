import { siteConfig } from "@/config/site";
import { resumeData } from "@/data/resume";

export function SiteFooter() {
    return (
        <footer className="site-footer">
            <div className="container footer-inner">
                <span>
                    © {new Date().getFullYear()} {siteConfig.name}
                </span>
                <div className="footer-links">
                    <a
                        href={resumeData.profile.linkedin.href}
                        target="_blank"
                        rel="noopener noreferrer me"
                    >
                        LinkedIn
                    </a>
                    <a
                        href={siteConfig.socials.github}
                        target="_blank"
                        rel="noopener noreferrer me"
                    >
                        GitHub
                    </a>
                    <a
                        href={siteConfig.socials.x}
                        target="_blank"
                        rel="noopener noreferrer me"
                    >
                        X
                    </a>
                </div>
            </div>
        </footer>
    );
}
