import type { Metadata } from "next";

import { GithubHeatmap } from "@/components/GithubHeatmap";
import { HomeWriting } from "@/components/HomeWriting";
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
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
    title: "Garvish Panchal",
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

const [addressRegion, addressCountry] = resumeData.profile.location
    .split(",")
    .map((part) => part.trim());

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
                siteConfig.socials.github,
                siteConfig.socials.x,
                ...resumeData.codingProfiles.map((profile) => profile.href),
            ],
            address: {
                "@type": "PostalAddress",
                addressRegion,
                addressCountry,
            },
            worksFor: {
                "@type": "Organization",
                name: resumeData.experiences[0]?.company ?? "Odoo",
            },
            hasOccupation: {
                "@type": "Occupation",
                name: resumeData.profile.role,
                skills: skillKeywords.join(", "),
            },
            alumniOf: {
                "@type": "CollegeOrUniversity",
                name: resumeData.education[0]?.institution,
            },
            hasCredential: resumeData.education.map((item) => ({
                "@type": "EducationalOccupationalCredential",
                credentialCategory: "degree",
                name: item.degree,
                recognizedBy: {
                    "@type": "CollegeOrUniversity",
                    name: item.institution,
                },
            })),
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
            hasPart: {
                "@id": `${resumeData.websiteUrl}#blog`,
            },
        },
        {
            "@type": "Blog",
            "@id": `${resumeData.websiteUrl}#blog`,
            url: `${resumeData.websiteUrl}/blog`,
            name: `${resumeData.profile.name} — Blog`,
            description:
                "Notes on software engineering, web performance, and system design.",
            author: {
                "@id": `${resumeData.websiteUrl}#person`,
            },
        },
        {
            "@type": "ProfilePage",
            "@id": `${resumeData.websiteUrl}#profile-page`,
            url: resumeData.websiteUrl,
            name: resumeData.seo.title,
            description: resumeData.seo.description,
            inLanguage: "en-IN",
            isPartOf: {
                "@id": `${resumeData.websiteUrl}#website`,
            },
            about: {
                "@id": `${resumeData.websiteUrl}#person`,
            },
            mainEntity: {
                "@id": `${resumeData.websiteUrl}#person`,
            },
            primaryImageOfPage: {
                "@type": "ImageObject",
                url: `${resumeData.websiteUrl}/opengraph-image`,
            },
        },
    ],
};

export default function Home() {
    const recentPosts = getAllPosts().slice(0, 3);

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(structuredData),
                }}
            />
            <a className="skip-link" href="#content">
                Skip to content
            </a>
            <main id="content" className="container page">
                <HeaderSection profile={resumeData.profile} />
                <SummarySection summary={resumeData.summary} />
                <SkillsSection skills={resumeData.skills} />
                <ExperienceSection experiences={resumeData.experiences} />
                <ProjectsSection projects={resumeData.projects} />
                <HomeWriting posts={recentPosts} />
                <AchievementsSection achievements={resumeData.achievements} />
                <CodingProfilesSection profiles={resumeData.codingProfiles} />
                <EducationSection education={resumeData.education} />
                <GithubHeatmap />
            </main>
        </>
    );
}
