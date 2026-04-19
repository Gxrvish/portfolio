export type ExternalLink = {
    label: string;
    href: string;
    display: string;
};

export type NavItem = {
    id: string;
    label: string;
};

export type SkillCategory = {
    title: string;
    values: string[];
};

export type ResumeExperience = {
    role: string;
    company: string;
    period: string;
    location: string;
    stack: string[];
    highlights: string[];
};

export type ResumeProject = {
    title: string;
    subtitle: string;
    year: string;
    tech: string[];
    highlights: string[];
    liveUrl?: string;
    repoUrl?: string;
};

export type ResumeAchievement = {
    text: string;
    reference?: ExternalLink;
};

export type ResumeEducation = {
    degree: string;
    institution: string;
    graduation: string;
    score: string;
};

export type ResumeProfile = {
    name: string;
    role: string;
    tagline: string;
    phone: string;
    email: string;
    linkedin: ExternalLink;
    location: string;
};

export type ResumeData = {
    profile: ResumeProfile;
    websiteUrl: string;
    navigation: NavItem[];
    summary: string;
    skills: SkillCategory[];
    experiences: ResumeExperience[];
    projects: ResumeProject[];
    achievements: ResumeAchievement[];
    codingProfiles: ExternalLink[];
    education: ResumeEducation[];
    seo: {
        title: string;
        description: string;
        keywords: string[];
    };
};
