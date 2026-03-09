"use client";
import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MessageSquare, Brain, BellRing } from "lucide-react";

if (typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
}

export default function PillarsSection() {
    const containerRef = useRef<HTMLDivElement>(null);
    const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        let ctx = gsap.context(() => {
            cardsRef.current.forEach((card, i) => {
                if (!card) return;
                gsap.fromTo(card,
                    { opacity: 0, y: 50 },
                    {
                        opacity: 1,
                        y: 0,
                        duration: 0.8,
                        ease: "power2.out",
                        scrollTrigger: {
                            trigger: card,
                            start: "top 80%",
                            toggleActions: "play none none reverse"
                        }
                    }
                );
            });
        }, containerRef);

        return () => ctx.revert();
    }, []);

    const pillars = [
        {
            icon: <MessageSquare size={48} className="text-juice mb-6" />,
            title: "Just Ask",
            description: "A personal assistant that understands plain English. Just ask for what you need—whether it's sending an email campaign or checking your ad spend—and it just works."
        },
        {
            icon: <Brain size={48} className="text-violet-400 mb-6" />,
            title: "Always On Context",
            description: "Babji remembers your business details, your preferences, and past conversations. You don't have to repeat yourself or explain the context ever again."
        },
        {
            icon: <BellRing size={48} className="text-green-400 mb-6" />,
            title: "Proactive Action",
            description: "It doesn't just wait for commands. Babji monitors your business health and proactively alerts you when urgent attention or an opportunity arises."
        }
    ];

    return (
        <section ref={containerRef} className="py-32 relative">
            <div className="container mx-auto px-6 relative z-10">
                <div className="text-center max-w-2xl mx-auto mb-20">
                    <h2 className="text-4xl md:text-5xl font-display text-[#2B211E] uppercase tracking-wider mb-6">
                        Built for <span className="juice-text font-bold">Business</span>
                    </h2>
                    <p className="text-lg text-[#2B211E]/70 font-mono">
                        No technical jargon. No complex setups. Just results.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {pillars.map((pillar, idx) => (
                        <div
                            key={idx}
                            ref={(el) => { cardsRef.current[idx] = el; }}
                            className="bg-white p-10 rounded-3xl border border-black/5 hover:border-[#D8232A]/30 shadow-2xl shadow-[#D8232A]/5 transition-colors duration-500 group"
                        >
                            <div className="transform group-hover:scale-110 group-hover:-translate-y-2 transition-transform duration-500">
                                {pillar.icon}
                            </div>
                            <h3 className="text-2xl font-display text-[#2B211E] mb-4 tracking-wide">{pillar.title}</h3>
                            <p className="font-mono text-[#2B211E]/70 leading-relaxed text-sm">
                                {pillar.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
