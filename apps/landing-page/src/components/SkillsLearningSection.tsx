"use client";
import React from "react";
import { GraduationCap, ArrowRight, BookOpen, Users } from "lucide-react";

export default function SkillsLearningSection() {
    return (
        <section className="py-24 bg-[#FDF8F5] relative overflow-hidden">
            {/* Subtle Grid Background */}
            <div className="absolute inset-0 opacity-[0.05] mix-blend-multiply" style={{ backgroundImage: "linear-gradient(#D8232A 1px, transparent 1px), linear-gradient(90deg, #D8232A 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

            <div className="container mx-auto px-6 relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

                {/* Left Text Content */}
                <div className="space-y-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#D8232A]/30 bg-[#D8232A]/10 text-[#D8232A] font-mono text-xs uppercase tracking-widest">
                        <GraduationCap size={14} /> Continuous Upskilling
                    </div>

                    <h2 className="text-4xl md:text-5xl font-serif text-[#2B211E] tracking-tight leading-tight">
                        The first AI assistant that <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D8232A] to-[#F1B434]">learns new skills.</span>
                    </h2>

                    <p className="text-lg text-[#2B211E]/70 font-mono leading-relaxed max-w-lg">
                        Babji is designed from the ground up to continuously evolve. If you need a capability he doesn't have yet, just ask.
                    </p>

                    <div className="space-y-6 pt-4">
                        <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-[#D8232A]/5 flex items-center justify-center shrink-0 border border-[#D8232A]/20">
                                <BookOpen size={18} className="text-[#D8232A]" />
                            </div>
                            <div>
                                <h4 className="text-[#2B211E] font-mono font-bold text-sm mb-1">Request a Skill</h4>
                                <p className="text-[#2B211E]/70 text-sm font-sans max-w-sm">Ask Babji to learn a new tool, integration, or workflow specific to your business.</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-[#F1B434]/10 flex items-center justify-center shrink-0 border border-[#F1B434]/30">
                                <Users size={18} className="text-[#F1B434]" />
                            </div>
                            <div>
                                <h4 className="text-[#2B211E] font-mono font-bold text-sm mb-1">Collaborative Learning</h4>
                                <p className="text-[#2B211E]/70 text-sm font-sans max-w-sm">Babji checks with other AI teachers and human experts to acquire the new skill safely.</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 border border-green-500/30">
                                <ArrowRight size={18} className="text-green-600" />
                            </div>
                            <div>
                                <h4 className="text-[#2B211E] font-mono font-bold text-sm mb-1">Ready to Use</h4>
                                <p className="text-[#2B211E]/70 text-sm font-sans max-w-sm">You get notified the moment the skill is mastered and ready to be deployed for you.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Visual Representation (Learning Chat UI) */}
                <div className="glass-panel bg-white p-6 rounded-3xl border border-black/5 shadow-2xl relative">
                    {/* Decorative dots */}
                    <div className="absolute top-4 left-4 flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-[#D8232A]/80"></div>
                        <div className="w-3 h-3 rounded-full bg-[#F1B434]/80"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                    </div>

                    <div className="mt-8 space-y-6 font-sans text-sm">
                        {/* User message */}
                        <div className="flex gap-3 justify-end">
                            <div className="bg-[#FDF8F5] text-[#2B211E] p-3 rounded-2xl rounded-tr-sm max-w-[80%] border border-black/5 shadow-sm">
                                Babji, can you sync our new leads with HubSpot?
                            </div>
                        </div>

                        {/* Babji message */}
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#D8232A] to-[#F1B434] flex items-center justify-center shrink-0 text-white font-bold font-serif text-sm">B</div>
                            <div className="bg-[#D8232A] text-white p-3 rounded-2xl rounded-tl-sm max-w-[80%] shadow-md">
                                I haven't learned the HubSpot integration skill yet. I will start learning it by coordinating with my instructor network immediately.
                            </div>
                        </div>

                        {/* Status indicator */}
                        <div className="flex gap-3 items-center px-4">
                            <div className="flex-1 border-t border-dashed border-[#2B211E]/10"></div>
                            <span className="text-xs font-mono text-[#2B211E]/50 bg-[#FDF8F5] px-2 py-1 rounded-full border border-black/5">2 Days Later</span>
                            <div className="flex-1 border-t border-dashed border-[#2B211E]/10"></div>
                        </div>

                        {/* Babji message 2 */}
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#D8232A] to-[#F1B434] flex items-center justify-center shrink-0 text-white font-bold font-serif text-sm">B</div>
                            <div className="bg-[#F1B434]/10 text-[#2B211E] p-3 rounded-2xl rounded-tl-sm max-w-[80%] border border-[#F1B434]/30 shadow-sm">
                                <span className="font-bold flex items-center gap-2 mb-1"><CheckCircle2 size={14} className="text-[#D8232A]" /> New Skill Mastered</span>
                                I'm now fully certified to manage HubSpot! I've synced your new leads. What else would you like me to organize?
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>
    );
}

// Temporary inline component for missing CheckCircle2 above
function CheckCircle2({ size, className }: { size: number, className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    );
}
