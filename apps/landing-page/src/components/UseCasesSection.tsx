"use client";
import React, { useState } from "react";
import { CalendarDays, User, TrendingUp, Newspaper, X, Loader2, CheckCircle2 } from "lucide-react";
import { joinWaitlist } from "@/app/actions/waitlist";

type UseCase = {
    id: string;
    title: string;
    description: string;
    icon: React.ElementType<{ size?: number }>;
    mockupMessages: { role: "user" | "babji"; text: React.ReactNode }[];
};

const useCases: UseCase[] = [
    {
        id: "schedule",
        title: "Never Miss a Beat",
        description: "Babji proactively reviews your calendar, highlighting critical meetings and clearing unnecessary noise so you can focus on leading.",
        icon: CalendarDays,
        mockupMessages: [
            {
                role: "user",
                text: "What's my schedule looking like today?"
            },
            {
                role: "babji",
                text: (
                    <>
                        <div className="font-bold mb-2">Morning Briefing</div>
                        <ul className="space-y-2">
                            <li><span className="text-[#D8232A] font-bold">10:00 AM</span> - Q3 Strategy Review (High Priority)</li>
                            <li><span className="text-[#D8232A] font-bold">1:30 PM</span> - Lunch with Sarah (Confirmed)</li>
                        </ul>
                        <div className="mt-3 text-[#2B211E]/70 text-xs italic">I've pushed your internal 3PM sync to tomorrow to give you focus time after lunch.</div>
                    </>
                )
            }
        ]
    },
    {
        id: "briefing",
        title: "Walk In Prepared",
        description: "Before any major meeting, Babji delivers a concise brief on the people you are meeting with—their recent news, company updates, and key talking points.",
        icon: User,
        mockupMessages: [
            {
                role: "user",
                text: "I'm meeting David from ApexCorp next. Give me a summary."
            },
            {
                role: "babji",
                text: (
                    <>
                        <div className="font-bold mb-2">Dossier: David Chen (ApexCorp)</div>
                        <ul className="space-y-1">
                            <li><strong>Company News:</strong> ApexCorp just announced a $50M Series B.</li>
                            <li><strong>Recent Post:</strong> He wrote about AI supply chain logistics on LinkedIn two days ago.</li>
                        </ul>
                        <div className="mt-3 bg-[#F1B434]/10 p-2 rounded border border-[#F1B434]/20 text-[#2B211E]/80 text-xs">
                            <strong>Babji Suggests:</strong> Congratulate him on the raise and pivot to how our logistics software integrates with his new scaling goals.
                        </div>
                    </>
                )
            }
        ]
    },
    {
        id: "marketing",
        title: "Optimize Your Reach",
        description: "Stop logging into complex dashboards. Babji monitors your ad spend and delivers actionable recommendations directly to you.",
        icon: TrendingUp,
        mockupMessages: [
            {
                role: "user",
                text: "How are my Google Ads performing this week?"
            },
            {
                role: "babji",
                text: (
                    <>
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-bold">Campaign Health</span>
                            <span className="text-green-600 font-bold bg-green-100 px-2 py-0.5 rounded text-xs">Healthy</span>
                        </div>
                        <p className="mb-2">Your "Summer Sale" campaign is driving a <strong>15% lower CPA</strong> than last month.</p>
                        <div className="rounded bg-red-50 p-2 border border-red-100 text-[#2B211E]/80 text-xs">
                            <strong>Recommendation:</strong> Shift $500 from the underperforming "Retargeting" ad group into the "Summer Sale" exact match keywords to maximize ROI this weekend. Shall I apply this?
                        </div>
                    </>
                )
            }
        ]
    },
    {
        id: "news",
        title: "Stay Ahead of the Curve",
        description: "Get curated summaries of industry-specific news without the doomscrolling. Babji knows your interests and cuts out the fluff.",
        icon: Newspaper,
        mockupMessages: [
            {
                role: "user",
                text: "Give me the top AI news from today."
            },
            {
                role: "babji",
                text: (
                    <>
                        <div className="font-bold mb-2">Industry Briefing: Artificial Intelligence</div>
                        <ul className="space-y-3">
                            <li>
                                <strong>1. New Claude Model Released</strong>
                                <p className="text-[#2B211E]/70 text-xs mt-0.5">Anthropic announced Claude 3.5 Sonnet, beating major benchmarks in coding and reasoning.</p>
                            </li>
                            <li>
                                <strong>2. Apple Intelligence Unveiled</strong>
                                <p className="text-[#2B211E]/70 text-xs mt-0.5">Apple integrates native generative AI into iOS 18, emphasizing on-device privacy.</p>
                            </li>
                        </ul>
                    </>
                )
            }
        ]
    }
];

export default function UseCasesSection() {
    const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");

    async function handleWaitlistSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setStatus("loading");
        setErrorMessage("");

        const form = e.currentTarget;
        const formData = new FormData(form);
        const result = await joinWaitlist(formData);

        if (result.success) {
            setStatus("success");
        } else {
            setStatus("error");
            setErrorMessage(result.error || "Something went wrong.");
        }
    }

    return (
        <section className="py-24 bg-[#FDF8F5] relative overflow-hidden">
            {/* Subtle Royal Accent Background */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#F1B434]/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[#D8232A]/5 rounded-full blur-[120px] translate-y-1/3 -translate-x-1/3 pointer-events-none" />

            <div className="container mx-auto px-6 relative z-10 space-y-32">

                {/* Section Header */}
                <div className="text-center max-w-2xl mx-auto mb-16">
                    <h2 className="text-4xl md:text-5xl font-display font-medium text-[#2B211E] uppercase tracking-wider mb-6">
                        The Royal Service <span className="juice-text font-bold">In Action</span>
                    </h2>
                    <p className="text-lg text-[#2B211E]/70 font-mono">
                        See exactly how Babji operates as your personal business concierge.
                    </p>
                </div>

                {/* Alternating Blocks */}
                <div className="space-y-32 md:space-y-40 drop-shadow-sm">
                    {useCases.map((useCase, index) => {
                        const isEven = index % 2 === 0;

                        return (
                            <div key={useCase.id} className={`flex flex-col ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-12 lg:gap-20 items-center`}>

                                {/* Text Content */}
                                <div className="flex-1 space-y-6">
                                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white shadow-md border border-[#FDF8F5] text-[#D8232A]">
                                        <useCase.icon size={24} />
                                    </div>
                                    <h3 className="text-3xl lg:text-4xl font-display text-[#2B211E] tracking-tight">
                                        {useCase.title}
                                    </h3>
                                    <p className="text-lg text-[#2B211E]/70 font-mono leading-relaxed">
                                        {useCase.description}
                                    </p>
                                </div>

                                {/* Chat Mockup Interface */}
                                <div className="flex-1 w-full max-w-lg lg:max-w-none">
                                    <div className="glass-panel bg-white p-6 md:p-8 rounded-[2rem] border border-black/5 shadow-2xl shadow-[#D8232A]/5">

                                        {/* Mockup Header */}
                                        <div className="flex items-center justify-center border-b border-[#2B211E]/5 pb-4 mb-6">
                                            <span className="font-mono text-xs font-bold tracking-[0.2em] text-[#2B211E]/40 uppercase">Encrypted Session</span>
                                        </div>

                                        {/* Chat Messages */}
                                        <div className="space-y-6 font-mono text-sm">
                                            {useCase.mockupMessages.map((msg, idx) => (
                                                <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>

                                                    {msg.role === 'babji' && (
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D8232A] to-[#F1B434] flex items-center justify-center shrink-0 text-white font-bold font-serif text-lg shadow-md">
                                                            B
                                                        </div>
                                                    )}

                                                    <div className={`
                                                        p-4 rounded-2xl max-w-[85%] leading-relaxed
                                                        ${msg.role === 'user'
                                                            ? 'bg-[#FDF8F5] text-[#2B211E] rounded-tr-sm border border-black/5'
                                                            : 'bg-white text-[#2B211E] rounded-tl-sm border border-[#D8232A]/10 shadow-[0_4px_20px_rgba(216,35,42,0.03)]'
                                                        }
                                                    `}>
                                                        {msg.text}
                                                    </div>

                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Call To Action Buttons */}
                <div className="mt-32 border-t border-[#2B211E]/10 pt-16 text-center max-w-3xl mx-auto">
                    <h3 className="text-2xl md:text-3xl font-display font-medium text-[#2B211E] mb-8">
                        Ready for Royal Service?
                    </h3>

                    <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
                        <a
                            href="https://t.me/BabjiFromQuantanaBot"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full sm:w-auto px-8 py-4 bg-[#D8232A] text-white font-bold tracking-widest font-mono uppercase text-sm rounded-full hover:bg-[#B3132B] transition-colors duration-300 shadow-xl shadow-[#D8232A]/20 flex items-center justify-center gap-3"
                        >
                            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.888-.662 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                            </svg>
                            Talk to Babji on Telegram
                        </a>

                        <div className="w-full sm:w-auto relative group">
                            <button
                                onClick={() => setIsWaitlistOpen(true)}
                                className="w-full px-8 py-4 bg-[#FDF8F5] text-[#2B211E]/80 font-bold tracking-widest font-mono uppercase text-sm rounded-full border border-[#2B211E]/30 cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 hover:bg-[#2B211E] hover:text-[#FDF8F5] hover:border-[#2B211E]"
                            >
                                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                                </svg>

                                <span className="group-hover:hidden transition-opacity">Talk to Babji on WhatsApp</span>
                                <span className="hidden group-hover:inline transition-opacity text-[#F1B434]">Click to Join Waitlist</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Waitlist Modal */}
            {isWaitlistOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2B211E]/40 backdrop-blur-sm">
                    <div className="bg-[#FDF8F5] p-8 rounded-3xl w-full max-w-md shadow-2xl relative border border-black/5" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setIsWaitlistOpen(false)}
                            className="absolute top-4 right-4 text-[#2B211E]/40 hover:text-[#2B211E] transition-colors"
                        >
                            <X size={24} />
                        </button>

                        <h3 className="text-2xl font-display font-bold text-[#2B211E] mb-2">Join the Waitlist</h3>
                        <p className="text-[#2B211E]/70 text-sm mb-6">Enter your email or phone number to get notified when Babji's WhatsApp integration drops.</p>

                        {status === "success" ? (
                            <div className="bg-green-50 border border-green-200 p-6 rounded-2xl flex flex-col items-center justify-center text-center space-y-3">
                                <CheckCircle2 className="text-green-600 w-12 h-12" />
                                <div className="text-green-800 font-bold">You're on the list!</div>
                                <div className="text-green-700 text-sm">We'll alert you the moment we launch.</div>
                            </div>
                        ) : (
                            <form onSubmit={handleWaitlistSubmit} className="space-y-4">
                                <div>
                                    <input
                                        type="text"
                                        name="contactInfo"
                                        placeholder="Email or Phone Number"
                                        className="w-full p-4 rounded-xl bg-white border border-black/10 focus:outline-none focus:ring-2 focus:ring-[#D8232A]/50 text-[#2B211E] placeholder:text-[#2B211E]/30"
                                        required
                                        disabled={status === "loading"}
                                    />
                                </div>
                                {status === "error" && (
                                    <div className="text-red-500 text-xs px-2">{errorMessage}</div>
                                )}
                                <button
                                    type="submit"
                                    disabled={status === "loading"}
                                    className="w-full bg-[#D8232A] hover:bg-[#B3132B] text-white font-bold py-4 rounded-xl transition-all shadow-md shadow-[#D8232A]/20 flex justify-center items-center"
                                >
                                    {status === "loading" ? <Loader2 className="animate-spin w-5 h-5" /> : "Secure My Spot"}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
