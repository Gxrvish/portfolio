import { Section } from "@/components/resume/Section";
import type { ResumeProject } from "@/types/resume";

type ProjectsSectionProps = {
    projects: ResumeProject[];
};

export function ProjectsSection({ projects }: ProjectsSectionProps) {
    return (
        <Section id="projects" title="Projects">
            <div className="entries">
                {projects.map((project) => (
                    <article key={project.title}>
                        <div className="entry-head">
                            <h3 className="entry-title">
                                {project.title}
                                <span className="entry-sub">
                                    {" "}
                                    · {project.subtitle}
                                </span>
                            </h3>
                            <p className="entry-period">{project.year}</p>
                        </div>

                        <p className="entry-meta">{project.tech.join(", ")}</p>

                        <ul className="bullets">
                            {project.highlights.map((highlight) => (
                                <li key={highlight}>{highlight}</li>
                            ))}
                        </ul>

                        {project.liveUrl || project.repoUrl ? (
                            <div className="entry-links">
                                {project.liveUrl ? (
                                    <a
                                        href={project.liveUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Live →
                                    </a>
                                ) : null}
                                {project.repoUrl ? (
                                    <a
                                        href={project.repoUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Source →
                                    </a>
                                ) : null}
                            </div>
                        ) : null}
                    </article>
                ))}
            </div>
        </Section>
    );
}
