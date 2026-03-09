import HeroSection from "@/components/HeroSection";
import PillarsSection from "@/components/PillarsSection";
import JuiceEconomy from "@/components/JuiceEconomy";
import SkillsLearningSection from "@/components/SkillsLearningSection";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="bg-obsidian min-h-screen text-white font-sans selection:bg-juice selection:text-obsidian flex flex-col pt-16">
      <HeroSection />
      <PillarsSection />
      <SkillsLearningSection />
      <JuiceEconomy />
      <Footer />
    </main>
  );
}
