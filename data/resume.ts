import { siteConfig } from "@/config/site";
import type { ResumeData } from "@/types/resume";

export const resumeData: ResumeData = {
    profile: {
        name: "Garvish Panchal",
        role: "Software Engineer",
        tagline:
            "Building scalable, performance-critical web products with a focus on clean architecture and distributed systems.",
        phone: "+91 7698480496",
        email: "garvish67@gmail.com",
        linkedin: {
            label: "LinkedIn",
            href: "https://www.linkedin.com/in/gxrvish/",
            display: "linkedin.com/in/gxrvish",
        },
        location: "Gujarat, India",
    },
    websiteUrl: siteConfig.url,
    navigation: [
        { id: "summary", label: "Summary" },
        { id: "skills", label: "Skills" },
        { id: "experience", label: "Experience" },
        { id: "projects", label: "Projects" },
        { id: "achievements", label: "Achievements" },
        { id: "coding-profiles", label: "Coding Profiles" },
        { id: "education", label: "Education" },
    ],
    summary:
        "Software Engineer with strong foundations in data structures, algorithms, and system design. Experienced in building scalable, performance-critical features in production systems, with interests in distributed systems, optimization, and clean architecture.",
    skills: [
        {
            title: "Programming and Querying",
            values: [
                "Java",
                "Python",
                "JavaScript",
                "TypeScript",
                "PHP",
                "SQL",
            ],
        },
        {
            title: "Frameworks and Libraries",
            values: [
                "Spring Boot",
                "React",
                "Next.js",
                "Node.js",
                "Express",
                "Tailwind CSS",
            ],
        },
        {
            title: "Developer Tools",
            values: ["Postman", "VS Code", "Linux", "Docker"],
        },
        {
            title: "Databases",
            values: ["MySQL", "PostgreSQL", "MongoDB", "DynamoDB"],
        },
    ],
    experiences: [
        {
            role: "Software Developer",
            company: "Odoo",
            period: "January 2025 - Present",
            location: "Onsite",
            stack: ["Python", "JavaScript", "PostgreSQL", "Docker"],
            highlights: [
                "Built an AI-powered full-page translation feature that traverses and maps DOM content while preserving visual layout.",
                "Refactored the sitemap generation pipeline, fixed incorrect URL generation, and reduced customer support tickets.",
                "Delivered production-focused performance, scalability, and extensibility improvements in a widely used Website Builder platform.",
            ],
        },
        {
            role: "Software Developer Intern",
            company: "Adnate Inventive Pvt. Ltd.",
            period: "January 2023 - May 2023",
            location: "Onsite",
            stack: ["PHP", "SQL", "Laravel"],
            highlights: [
                "Independently designed and developed a fully customizable production web application from scratch in 2 months.",
                "Implemented role-based access control for super-admin, admin, and user roles to secure content and workflows.",
            ],
        },
    ],
    projects: [
        {
            title: "Babynotion",
            subtitle: "Notion-like Collaborative Notes",
            year: "2025",
            tech: ["Next.js", "TypeScript", "Convex", "Clerk", "BlockNote"],
            highlights: [
                "Built a Notion-style collaborative note-taking application with a block-based editor using BlockNote.",
                "Implemented real-time collaboration with recyclable notes for structured editing and safe recovery workflows.",
                "Used a modular architecture that supports editor feature expansion and scalable collaboration behavior.",
            ],
            liveUrl: "https://noteapp.garvish.tech",
            repoUrl: "https://github.com/Gxrvish/babynotion",
        },
        {
            title: "Frontend Catch The Bug",
            subtitle: "Frontend Debugging Challenge Platform",
            year: "2026",
            tech: ["Next.js", "TypeScript", "Vitest", "Tailwind CSS"],
            highlights: [
                "Built challenge-driven debugging workflows where developers reproduce, reason about, and fix real-world frontend bugs.",
                "Structured challenge authoring around buggy main implementations and reference fixes to improve practical debugging skills.",
                "Focused on high-signal bug scenarios covering async state, rendering issues, and production-style UI constraints.",
            ],
            liveUrl: "https://catch-the-bug.garvish.tech",
            repoUrl: "https://github.com/Gxrvish/frontend-catch-the-bug",
        },
        {
            title: "Machine Coding React",
            subtitle: "Interview-style Component Playground",
            year: "2026",
            tech: ["Next.js", "React", "TypeScript", "Redux Toolkit", "Vitest"],
            highlights: [
                "Designed a machine-coding practice platform with challenge routes for reusable component patterns and interview workflows.",
                "Implemented multiple interactive UI systems including infinite scroll, file explorer, dialogs, forms, and virtualized list scenarios.",
                "Added testing support with Vitest and React Testing Library to validate component behavior and state logic.",
            ],
            liveUrl: "https://machine-coding.garvish.tech",
            repoUrl: "https://github.com/Gxrvish/machine-coding-react",
        },
        {
            title: "Problexa",
            subtitle: "Developer Hiring SaaS Platform",
            year: "2026",
            tech: [
                "React",
                "TypeScript",
                "Vite",
                "Java",
                "Spring Boot",
                "PostgreSQL",
                "Docker",
            ],
            highlights: [
                "Built a hiring SaaS with Problem Mode and Interview Mode to evaluate practical engineering skills beyond standard DSA rounds.",
                "Designed a microservice architecture with dedicated auth, problem, and interview services backed by separate PostgreSQL databases.",
                "Implemented GitHub issue-based interview flows where candidates submit pull requests with reasoning, alternatives, and AI-usage justification.",
            ],
            repoUrl: "https://github.com/Gxrvish/Problexa",
        },
    ],
    achievements: [
        {
            text: "Solved 800+ data structures and algorithms problems across LeetCode, GeeksforGeeks, Codeforces, and CodeChef.",
        },
        {
            text: "Identified and responsibly disclosed a security flaw in Instagram Stories using Burp Suite that caused crashes on affected devices.",
            reference: {
                label: "Disclosure post",
                href: "https://www.linkedin.com/posts/gxrvish_android-security-instagram-activity-7014980161741688832-G9WN",
                display: "linkedin.com/posts/gxrvish/...",
            },
        },
    ],
    codingProfiles: [
        {
            label: "LeetCode",
            href: "https://leetcode.com/u/gxrvish/",
            display: "leetcode.com/u/gxrvish",
        },
        {
            label: "GeeksforGeeks",
            href: "https://www.geeksforgeeks.org/profile/gxrvish",
            display: "geeksforgeeks.org/profile/gxrvish",
        },
        {
            label: "Codeforces",
            href: "https://codeforces.com/profile/gxrvish",
            display: "codeforces.com/profile/gxrvish",
        },
        {
            label: "CodeChef",
            href: "https://www.codechef.com/users/gxrvish",
            display: "codechef.com/users/gxrvish",
        },
    ],
    education: [
        {
            degree: "B.E. Information Technology",
            institution: "Gujarat Technological University, Gujarat",
            graduation: "July 2025",
            score: "CGPA: 7.77 / 10",
        },
    ],
    seo: {
        title: "Garvish Panchal Resume Portfolio",
        description:
            "Garvish Panchal is a software engineer specializing in scalable web systems, optimization, and clean architecture. Explore experience at Odoo, projects, achievements, and coding profiles.",
        keywords: [
            "Garvish Panchal",
            "Software Engineer",
            "Full Stack Developer",
            "Next.js portfolio",
            "TypeScript developer",
            "Odoo developer",
            "web performance engineer",
            "resume portfolio",
            "India software engineer",
        ],
    },
};
