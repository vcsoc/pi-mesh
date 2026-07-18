/**
 * Funny Status Messages Extension
 * 
 * Replaces the default "Working..." status with random humorous messages
 * to make waiting for the AI more entertaining.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FUNNY_MESSAGES = [
  "Sanka, ya dead?", // Cool Runnings
  "Feel the rhythm! Feel the rhyme!", // Cool Runnings
  "Kiss my lucky egg!", // Cool Runnings
  "If you're not enough without it, you'll never be enough with it.", // Cool Runnings

  "Schwing!", // Wayne's World
  "Party on, Wayne!", // Wayne's World
  "Party on, Garth!", // Wayne's World
  "We're not worthy!", // Wayne's World
  "It will be mine. Oh yes, it will be mine.", // Wayne's World

  "I'm your worst nightmare... a 300-pound undercover cop.", // Who's Harry Crumb?
  "I tripled my body weight for this assignment.", // Who's Harry Crumb?
  "Trust me, I know what I'm doing. Sort of.", // Who's Harry Crumb-inspired

  "Get that corn outta my face!", // Nacho Libre
  "I am... I am the gatekeeper of my own destiny.", // Nacho Libre
  "Chancho, when you are a man, sometimes you wear stretchy pants.", // Nacho Libre
  "Beneath the clothes, we find a man... and beneath the man we find his nucleus.", // Nacho Libre
  "It's the best!", // Nacho Libre

  "So you're telling me there's a chance!", // Dumb and Dumber
  "Big gulps, huh? Welp, see ya later!", // Dumb and Dumber
  "Our pets' heads are falling off!", // Dumb and Dumber
  "Mock... yeah... ing... yeah... bird... yeah...", // Dumb and Dumber
  "Just when I think you couldn't possibly be any dumber...", // Dumb and Dumber

  "Roads? Where we're going, we don't need roads.", // Back to the Future
  "1.21 gigawatts?!", // Back to the Future
  "Be excellent to each other.", // Bill & Ted
  "Strange things are afoot at the Circle K.", // Bill & Ted
  "Look (luke)... der is your fartha...", // South African Winners
  "Looks like I picked the wrong week to quit sniffing glue.", // Airplane!
  "Don't call me Shirley.", // Airplane!
  "Game over, man! Game over!", // Aliens
  "Yipee-ka-yay motherf***er!", // Die Hard
  "Get to the chopper!", // Predator
  "Keep the change, ya filthy animal!", // Home Alone
  "As if!", // Clueless
  "Show me the money!", // Jerry Maguire
];

export default function (pi: ExtensionAPI) {
  let currentMessage: string | undefined;

  // When agent starts processing, show a funny message
  pi.on("agent_start", async (_event, ctx) => {
    // Pick a random message
    currentMessage = FUNNY_MESSAGES[Math.floor(Math.random() * FUNNY_MESSAGES.length)];
    ctx.ui.setWorkingMessage(currentMessage);
  });

  // When agent finishes, restore default behavior
  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(); // Clear/restore default
    currentMessage = undefined;
  });

  // Optional: Also show funny messages during tool execution
  pi.on("tool_execution_start", async (_event, ctx) => {
    // Only update if we're already showing a message and randomly decide to change it (50% chance)
    if (currentMessage && Math.random() > 0.5) {
      currentMessage = FUNNY_MESSAGES[Math.floor(Math.random() * FUNNY_MESSAGES.length)];
      ctx.ui.setWorkingMessage(currentMessage);
    }
  });
}