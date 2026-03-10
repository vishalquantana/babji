import HeroSection from "@/components/HeroSection";
import PillarsSection from "@/components/PillarsSection";
import JuiceEconomy from "@/components/JuiceEconomy";
import SkillsLearningSection from "@/components/SkillsLearningSection";
import UseCasesSection from "@/components/UseCasesSection";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen font-sans selection:bg-juice selection:text-[#FDF8F5] flex flex-col pt-16">
      <HeroSection />
      <PillarsSection />
      <UseCasesSection />
      <SkillsLearningSection />
      <JuiceEconomy />
      <Footer />
    </main>
  );
}
