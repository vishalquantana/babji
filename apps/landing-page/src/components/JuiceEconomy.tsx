"use client";
import React, { useState } from "react";
import { Zap, CreditCard, CheckCircle2 } from "lucide-react";

export default function JuiceEconomy() {
    const [isAnnual, setIsAnnual] = useState(false);

    return (
        <section className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center py-24">
            {/* Background glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-royal-red/5 blur-[120px] pointer-events-none" />

            <div className="container mx-auto px-6 max-w-6xl relative z-10">
                <div className="text-center space-y-6 mb-20">
                    <h2 className="text-4xl md:text-5xl font-serif text-[#2B211E] tracking-widest uppercase">
                        Simple <span className="juice-text font-bold">Pricing</span>
                    </h2>
                    <p className="text-xl text-[#2B211E]/60 font-mono tracking-wide max-w-2xl mx-auto">
                        Pay for the actions you need, or subscribe to save.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                    {/* Pay As You Go */}
                    <div className="bg-white p-10 rounded-3xl flex flex-col relative border border-black/5 hover:border-[#D8232A]/30 shadow-2xl shadow-[#D8232A]/5 transition-colors">
                        <div className="mb-8">
                            <h3 className="font-serif text-2xl text-[#2B211E] tracking-wider mb-2">Pay As You Go</h3>
                            <p className="text-[#2B211E]/50 font-mono text-sm max-w-[250px]">Perfect for occasional tasks and getting to know Babji.</p>
                        </div>

                        <div className="mb-8">
                            <div className="flex items-end gap-2 mb-2">
                                <span className="font-mono text-5xl font-bold text-[#2B211E]">$10</span>
                            </div>
                            <div className="text-[#F1B434] font-mono font-bold tracking-wide flex justify-start items-center gap-2">
                                <Zap size={16} /> 100 Action Credits
                            </div>
                        </div>

                        <ul className="space-y-4 mb-10 flex-1">
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-green-600 shrink-0" /> Prepaid credits never expire</li>
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-green-600 shrink-0" /> Access to all skills</li>
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-green-600 shrink-0" /> Standard support</li>
                        </ul>

                        <button className="w-full py-4 rounded-full font-mono text-sm font-bold tracking-widest uppercase border border-[#2B211E]/20 text-[#2B211E] hover:bg-[#2B211E] hover:text-white transition-colors">
                            Buy Credits
                        </button>
                    </div>

                    {/* Subscription */}
                    <div className="bg-white p-10 rounded-3xl flex flex-col relative border-2 border-[#F1B434]/50 shadow-2xl shadow-[#F1B434]/10 transform md:-translate-y-4 z-10 overflow-hidden">
                        {/* Shimmer Effect */}
                        <div className="absolute top-0 -left-[100%] w-[50%] h-full bg-gradient-to-r from-transparent via-[#F1B434]/10 to-transparent skew-x-[30deg] animate-[shimmer_3s_infinite]" />

                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#F1B434] text-white px-4 py-1 rounded-full text-xs font-bold font-mono uppercase tracking-widest shadow-md shadow-[#F1B434]/20">
                            Most Popular
                        </div>

                        <div className="mb-8 mt-2">
                            <h3 className="font-serif text-2xl text-[#2B211E] tracking-wider mb-2">Pro Subscription</h3>
                            <p className="text-[#2B211E]/50 font-mono text-sm max-w-[250px]">Consistent growth requires consistent capability.</p>
                        </div>

                        <div className="mb-8">
                            <div className="flex items-end gap-2 mb-2">
                                <span className="font-mono text-5xl font-bold juice-text">$50</span>
                                <span className="text-[#2B211E]/50 font-mono mb-1">/mo</span>
                            </div>
                            <div className="text-[#F1B434] font-mono font-bold tracking-wide flex justify-start items-center gap-2">
                                <Zap size={16} /> 750 Action Credits <span className="bg-[#F1B434]/10 text-[#F1B434] text-[10px] px-2 py-0.5 rounded-full">(50% Bonus)</span>
                            </div>
                        </div>

                        <ul className="space-y-4 mb-10 flex-1">
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-[#F1B434] shrink-0" /> 750 monthly credits automatically refilled</li>
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-[#F1B434] shrink-0" /> Priority processing</li>
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-[#F1B434] shrink-0" /> Access to Beta skills</li>
                            <li className="flex text-[#2B211E]/70 font-mono text-sm gap-3 items-start"><CheckCircle2 size={18} className="text-[#F1B434] shrink-0" /> 24/7 Priority support</li>
                        </ul>

                        <button className="w-full py-4 rounded-full font-mono text-sm font-bold tracking-widest uppercase bg-[#D8232A] text-white hover:bg-[#B3132B] transition-colors shadow-lg shadow-[#D8232A]/20">
                            Start Free Trial
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
