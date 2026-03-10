"use server";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

export async function joinWaitlist(formData: FormData) {
    const contactInfo = formData.get("contactInfo") as string;

    if (!contactInfo || contactInfo.trim() === "") {
        return { success: false, error: "Please provide an email or phone number." };
    }

    try {
        // Ensure table exists (Safe to run on each action for a simple setup, though not strictly optimal)
        await db.execute(`
            CREATE TABLE IF NOT EXISTS whatsapp_waitlist (
                id TEXT PRIMARY KEY,
                contact TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert the waitlist entry
        await db.execute({
            sql: "INSERT INTO whatsapp_waitlist (id, contact) VALUES (?, ?)",
            args: [randomUUID(), contactInfo]
        });

        return { success: true };
    } catch (error) {
        console.error("Waitlist DB Error:", error);
        return { success: false, error: "Failed to join waitlist. Please try again later." };
    }
}
