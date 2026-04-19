import type { Metadata } from "next";

import { AchievementsSection } from "@/components/resume/AchievementsSection";
import { CodingProfilesSection } from "@/components/resume/CodingProfilesSection";
import { EducationSection } from "@/components/resume/EducationSection";
import { ExperienceSection } from "@/components/resume/ExperienceSection";
import { HeaderSection } from "@/components/resume/HeaderSection";
import { ProjectsSection } from "@/components/resume/ProjectsSection";
import { SkillsSection } from "@/components/resume/SkillsSection";
import { SummarySection } from "@/components/resume/SummarySection";
import { siteConfig } from "@/config/site";
import { resumeData } from "@/data/resume";

export const metadata: Metadata = {
    title: "Software Engineer Resume",
    description: resumeData.seo.description,
    keywords: resumeData.seo.keywords,
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: resumeData.seo.title,
        description: resumeData.seo.description,
        url: siteConfig.url,
        type: "website",
        images: [
            {
                url: "/opengraph-image",
                width: 1200,
                height: 630,
                alt: "Garvish Panchal Software Engineer Portfolio",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: resumeData.seo.title,
        description: resumeData.seo.description,
        images: ["/opengraph-image"],
    },
};

const skillKeywords = Array.from(
    new Set(resumeData.skills.flatMap((group) => group.values))
);

const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "Person",
            "@id": `${resumeData.websiteUrl}#person`,
            name: resumeData.profile.name,
            jobTitle: resumeData.profile.role,
            description: resumeData.profile.tagline,
            url: resumeData.websiteUrl,
            email: `mailto:${resumeData.profile.email}`,
            telephone: resumeData.profile.phone,
            sameAs: [
                resumeData.profile.linkedin.href,
                ...resumeData.codingProfiles.map((profile) => profile.href),
            ],
            worksFor: {
                "@type": "Organization",
                name: "Odoo",
            },
            alumniOf: {
                "@type": "CollegeOrUniversity",
                name: resumeData.education[0]?.institution,
            },
            knowsAbout: skillKeywords,
        },
        {
            "@type": "WebSite",
            "@id": `${resumeData.websiteUrl}#website`,
            url: resumeData.websiteUrl,
            name: `${resumeData.profile.name} Portfolio`,
            inLanguage: "en-IN",
            description: resumeData.seo.description,
            author: {
                "@id": `${resumeData.websiteUrl}#person`,
            },
        },
        {
            "@type": "ProfilePage",
            "@id": `${resumeData.websiteUrl}#profile-page`,
            url: resumeData.websiteUrl,
            name: resumeData.seo.title,
            isPartOf: {
                "@id": `${resumeData.websiteUrl}#website`,
            },
            about: {
                "@id": `${resumeData.websiteUrl}#person`,
            },
        },
    ],
};

export default function Home() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(structuredData),
                }}
            />
            <div className="page-shell">
                <HeaderSection
                    profile={resumeData.profile}
                    navItems={resumeData.navigation}
                />
                <main id="content" className="resume-main">
                    <SummarySection summary={resumeData.summary} />
                    <SkillsSection skills={resumeData.skills} />
                    <ExperienceSection experiences={resumeData.experiences} />
                    <ProjectsSection projects={resumeData.projects} />
                    <AchievementsSection
                        achievements={resumeData.achievements}
                    />
                    <CodingProfilesSection
                        profiles={resumeData.codingProfiles}
                    />
                    <EducationSection education={resumeData.education} />
                </main>
            </div>
        </>
    );
}
