import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";

describe("PromptBuilder", () => {
  it("builds system prompt from soul + memory + skills", () => {
    const prompt = PromptBuilder.build({
      soul: "You are Babji, a friendly AI assistant.",
      memory: "User's name is Alice. She runs a bakery.",
      skills: [
        {
          name: "gmail",
          displayName: "Gmail",
          description: "Manage emails",
          actions: [
            {
              name: "list_emails",
              description: "List emails",
              parameters: {},
            },
          ],
          creditsPerAction: 1,
        },
      ],
      connections: ["gmail"],
    });

    expect(prompt).toContain("You are Babji");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("bakery");
    expect(prompt).toContain("gmail");
    expect(prompt).toContain("list_emails");
  });

  it("shows default memory for new clients", () => {
    const prompt = PromptBuilder.build({
      soul: "You are Babji.",
      memory: "",
      skills: [],
      connections: [],
    });

    expect(prompt).toContain("Nothing yet -- this is a new client.");
  });

  it("shows no services connected when connections are empty", () => {
    const prompt = PromptBuilder.build({
      soul: "You are Babji.",
      memory: "",
      skills: [],
      connections: [],
    });

    expect(prompt).toContain("No services connected yet.");
  });

  it("filters skills that require auth but are not connected", () => {
    const prompt = PromptBuilder.build({
      soul: "You are Babji.",
      memory: "",
      skills: [
        {
          name: "gmail",
          displayName: "Gmail",
          description: "Manage emails",
          requiresAuth: { provider: "google", scopes: ["gmail.readonly"] },
          actions: [
            {
              name: "list_emails",
              description: "List emails",
              parameters: {},
            },
          ],
          creditsPerAction: 1,
        },
        {
          name: "calculator",
          displayName: "Calculator",
          description: "Do math",
          actions: [
            {
              name: "calculate",
              description: "Calculate expression",
              parameters: {
                expression: { type: "string", required: true },
              },
            },
          ],
          creditsPerAction: 0,
        },
      ],
      connections: [],
    });

    // Gmail requires auth and is not connected, so should be filtered out
    expect(prompt).not.toContain("Gmail");
    expect(prompt).not.toContain("list_emails");
    // Calculator does not require auth, so should be included
    expect(prompt).toContain("Calculator");
    expect(prompt).toContain("calculate");
  });

  it("includes action parameters in prompt", () => {
    const prompt = PromptBuilder.build({
      soul: "You are Babji.",
      memory: "",
      skills: [
        {
          name: "weather",
          displayName: "Weather",
          description: "Check weather",
          actions: [
            {
              name: "get_forecast",
              description: "Get weather forecast",
              parameters: {
                city: { type: "string", required: true },
                days: { type: "number" },
              },
            },
          ],
          creditsPerAction: 1,
        },
      ],
      connections: ["weather"],
    });

    expect(prompt).toContain("city: string (required)");
    expect(prompt).toContain("days: number");
  });
});
