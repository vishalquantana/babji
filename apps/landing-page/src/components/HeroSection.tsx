"use client";
import React, { useEffect, useRef } from "react";
import { MessageCircle, Mail, DollarSign, Calendar } from "lucide-react";
import gsap from "gsap";
import ThreeCore from "./ThreeCore";

export default function HeroSection() {
    const messageRef = useRef<HTMLDivElement>(null);
    const pulseRef = useRef<HTMLDivElement>(null);
    const serviceRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 3 });

        // 1. WhatsApp Message pops up
        tl.fromTo(
            messageRef.current,
            { opacity: 0, y: 20, scale: 0.95 },
            { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.7)" }
        );

        // 2. Pulse fires towards the center
        tl.fromTo(
            pulseRef.current,
            { x: -100, opacity: 0, scaleX: 0 },
            { x: 300, opacity: 1, scaleX: 1, duration: 0.8, ease: "power2.inOut" },
            "+=0.5"
        );

        // 3. Service grid items light up (Ads and Calendar)
        tl.to(
            [serviceRefs.current[1], serviceRefs.current[3]],
            {
                boxShadow: "0 0 20px rgba(255, 215, 0, 0.8)",
                borderColor: "rgba(255, 215, 0, 0.5)",
                y: -5,
                duration: 0.4,
                ease: "power1.out",
                stagger: 0.1,
            },
            "-=0.2"
        );

        // 4. Stay lit for a moment, then fade
        tl.to(
            [serviceRefs.current[1], serviceRefs.current[3]],
            {
                boxShadow: "0 0 0px rgba(255, 215, 0, 0)",
                borderColor: "rgba(255, 255, 255, 0.1)",
                y: 0,
                duration: 0.8,
                ease: "power2.in",
            },
            "+=1.5"
        );

        tl.to(
            messageRef.current,
            { opacity: 0, y: -20, scale: 0.95, duration: 0.4, ease: "power2.in" },
            "-=0.8"
        );

        return () => {
            tl.kill();
        };
    }, []);

    return (
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
            <ThreeCore />

            <div className="container mx-auto px-6 relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-12 items-center">

                {/* Left: WhatsApp Interface Mock */}
                <div className="space-y-6 flex flex-col items-start hidden lg:flex">
                    <div className="glass-panel p-4 w-72 h-[400px] flex flex-col justify-end space-y-4 relative">
                        <div className="absolute top-4 left-4 right-4 flex items-center justify-between pb-4 border-b border-white/10">
                            <div className="flex items-center space-x-2">
                                <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-600">
                                    <MessageCircle size={18} />
                                </div>
                                <span className="font-mono text-sm tracking-widest text-[#2B211E]/80">BABJI CHAT</span>
                            </div>
                        </div>

                        <div
                            ref={messageRef}
                            className="bg-[#D8232A] text-white p-3 rounded-2xl rounded-tr-sm text-sm self-end font-sans shadow-[0_4px_15px_rgba(216,35,42,0.2)] origin-bottom-right"
                        >
                            "Babji, check my ads and clear my morning."
                        </div>
                    </div>
                </div>

                {/* Center: Hero Copy */}
                <div className="text-center flex flex-col items-center justify-center space-y-6">
                    <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight text-[#2B211E] drop-shadow-sm leading-[1.2]">
                        <span className="juice-text">Babji</span> is the secret to <br className="hidden md:inline" />
                        your business success.
                    </h1>
                    <p className="text-lg md:text-xl text-[#2B211E]/70 max-w-lg font-mono tracking-wide leading-relaxed">
                        A personal assistant that understands your business. Just ask for what you need, and it works.
                    </p>
                    <button className="mt-8 px-8 py-4 bg-[#D8232A] text-white font-bold tracking-widest font-mono uppercase text-sm rounded-full hover:bg-[#B3132B] transition-colors duration-300 shadow-xl shadow-[#D8232A]/20 cursor-pointer z-50">
                        Summon Babji
                    </button>

                    <div
                        ref={pulseRef}
                        className="absolute top-1/2 left-1/3 w-32 h-1 bg-gradient-to-r from-transparent via-juice to-transparent blur-[2px] opacity-0 pointer-events-none"
                    />
                </div>

                {/* Right: Service Grid */}
                <div className="hidden lg:grid grid-cols-2 gap-4 place-items-center">
                    {[
                        { Icon: Mail, label: "Gmail", id: 0 },
                        { Icon: DollarSign, label: "Google Ads", id: 1 },
                        { Icon: MessageCircle, label: "Meta", id: 2 },
                        { Icon: Calendar, label: "Calendar", id: 3 },
                    ].map((service, idx) => (
                        <div
                            key={idx}
                            ref={(el) => { serviceRefs.current[idx] = el; }}
                            className="glass-panel w-32 h-32 flex flex-col items-center justify-center space-y-3 transition-colors duration-300"
                        >
                            <service.Icon size={32} className="text-[#2B211E]/60" />
                            <span className="font-mono text-xs text-[#2B211E]/50">{service.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
