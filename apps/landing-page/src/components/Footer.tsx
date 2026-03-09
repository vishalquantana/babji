"use client";
import React from "react";
import { QrCode, ArrowRight } from "lucide-react";

export default function Footer() {
    return (
        <footer className="bg-[#2B211E] min-h-screen py-24 flex flex-col items-center justify-center text-center relative overflow-hidden">

            {/* Background radial gradient to transition from section above */}
            <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-[#FDF8F5] to-transparent pointer-events-none opacity-20" />

            <div className="container mx-auto px-6 space-y-16 relative z-10 flex flex-col items-center justify-center">

                <h2 className="text-5xl md:text-7xl font-display text-[#FDF8F5] uppercase tracking-tight">
                    Talk to <span className="juice-text font-bold">Babji</span>.
                </h2>

                <p className="text-xl md:text-3xl font-mono italic text-[#F1B434]/80 max-w-2xl px-4 text-center leading-relaxed">
                    He's already waiting for your first task.
                </p>

                <div className="relative group cursor-pointer">
                    {/* Centered QR Code Area */}
                    <div className="w-64 h-64 md:w-80 md:h-80 bg-[#FDF8F5]/5 border border-[#FDF8F5]/20 rounded-3xl flex flex-col items-center justify-center shadow-[0_0_40px_rgba(241,180,52,0.1)] transition-all duration-500 group-hover:-translate-y-2 group-hover:shadow-[0_0_60px_rgba(241,180,52,0.3)] group-hover:border-[#F1B434]/50 overflow-hidden relative">
                        <QrCode size={160} className="text-[#FDF8F5] opacity-80 group-hover:opacity-100 group-hover:text-[#F1B434] transition-colors duration-500 z-10" />
                        <span className="font-mono text-xs uppercase tracking-[0.3em] mt-8 text-[#FDF8F5]/50 group-hover:text-[#F1B434]/80 transition-colors z-10">Scan to Begin</span>

                        {/* Scanline Animation */}
                        <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-gradient-to-b from-transparent via-[#F1B434]/20 to-transparent rotate-45 transform -translate-y-[100%] animate-[scan_3s_infinite_linear] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    <div className="absolute -inset-4 rounded-3xl bg-[#D8232A]/20 blur-2xl opacity-0 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none -z-10" />
                </div>

                <button className="flex items-center gap-2 mt-12 px-8 py-4 bg-transparent border border-[#FDF8F5]/20 hover:border-[#F1B434] text-[#FDF8F5] hover:text-[#F1B434] font-mono uppercase text-sm rounded-full transition-all duration-300 group">
                    Open in Telegram/WhatsApp <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </button>

            </div>

            <div className="absolute bottom-8 text-[#FDF8F5]/30 font-mono text-xs uppercase tracking-widest text-center w-full">
                &copy; {new Date().getFullYear()} Babji AI. All Operations Secure.
            </div>
        </footer>
    );
}
