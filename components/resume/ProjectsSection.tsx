import { Section } from "@/components/resume/Section";
import type { ResumeProject } from "@/types/resume";

type ProjectsSectionProps = {
    projects: ResumeProject[];
};

export function ProjectsSection({ projects }: ProjectsSectionProps) {
    return (
        <Section id="projects" title="Projects">
            <div className="stack-list">
                {projects.map((project) => (
                    <article key={project.title} className="entry-card">
                        <header className="entry-head">
                            <h3 className="entry-title">
                                {project.title}
                                <span className="entry-company">
                                    {" "}
                                    - {project.subtitle}
                                </span>
                            </h3>
                            <p className="entry-period">{project.year}</p>
                        </header>

                        <p className="entry-meta">{project.tech.join(" | ")}</p>

                        <ul className="bullet-list">
                            {project.highlights.map((highlight) => (
                                <li key={highlight}>{highlight}</li>
                            ))}
                        </ul>

                        {project.liveUrl ? (
                            <a
                                className="project-link"
                                href={project.liveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Live project:{" "}
                                {project.liveUrl.replace("https://", "")}
                            </a>
                        ) : null}
                    </article>
                ))}
            </div>
        </Section>
    );
}
