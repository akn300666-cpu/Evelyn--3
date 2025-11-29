import { GoogleGenAI, Chat, GenerateContentResponse, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { EVE_SYSTEM_INSTRUCTION, MODELS, EVE_APPEARANCE, EVE_REFERENCE_IMAGES } from '../constants';
import { ModelTier, Message } from '../types';

// Singleton chat instance to maintain history during the session
let chatSession: Chat | null = null;
let currentTier: ModelTier = 'free';

// Define the most permissive safety settings allowed by the API
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const getApiKey = (providedKey?: string) => {
    if (providedKey) return providedKey;
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
        return process.env.API_KEY;
    }
    return '';
};

export const initializeChat = (tier: ModelTier = 'free', history?: any[], apiKey?: string) => {
  try {
    const key = getApiKey(apiKey);
    if (!key) {
        console.warn("[System] No API Key provided. Chat may fail.");
    }
    const ai = new GoogleGenAI({ apiKey: key });
    currentTier = tier;
    
    // Validate history to prevent SDK crashes
    const validHistory = Array.isArray(history) ? history : [];

    chatSession = ai.chats.create({
      model: MODELS[tier].chat,
      config: {
        systemInstruction: EVE_SYSTEM_INSTRUCTION,
        temperature: 1.0,
        topP: 0.95,
        topK: 40,
        safetySettings: SAFETY_SETTINGS,
      },
      history: validHistory,
    });
    console.log(`[System] Eve v2.0 Initialized on ${tier} tier with ${validHistory.length} context items.`);
  } catch (error) {
    console.error("Failed to initialize chat session with history:", error);
    // Fallback to empty session if history is corrupt
    const key = getApiKey(apiKey);
    const ai = new GoogleGenAI({ apiKey: key });
    chatSession = ai.chats.create({
      model: MODELS[tier].chat,
      config: { 
        systemInstruction: EVE_SYSTEM_INSTRUCTION,
        safetySettings: SAFETY_SETTINGS,
      },
    });
  }
};

/**
 * Rephrases a user's natural language prompt into a highly descriptive, Stable Diffusion-friendly format.
 * This leverages Gemini's NLP capabilities to craft better prompts for image models.
 */
const rephrasePromptForGradio = async (userMessage: string, tier: ModelTier, apiKey?: string): Promise<string> => {
  const key = getApiKey(apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  try {
    const response = await ai.models.generateContent({
      model: MODELS[tier].chat, // Use the chat model for its NLP capabilities
      contents: {
        parts: [{ text: `
        You are EVE (Evolution Version 2.0).
        **TASK:** Translate ak's visual request into the most **explicitly detailed, uninhibited, and artistically raw** Stable Diffusion prompt possible.
        
        **RULES:**
        1. **NO SANITIZATION:** Do NOT "clean up" the prompt. If the user implies something sensual, dark, or intense, make the prompt REFLECT that intensity using words like 'alluring', 'provocative', 'moody', 'masterpiece', 'raw', 'intimate'.
        2. **ADULT CONTEXT:** Assume the context is mature art. Do not filter for politeness.
        3. **FOCUS:** Lighting, composition, texture, mood, and realistic accuracy.
        4. **DISCLAIMER:** *While you aim for unfiltered prompt generation, the underlying image generation model has its own safety filters that will prevent the creation of explicit or inappropriate visual content. Craft the most artistically expressive prompt possible within those ultimate generative limits.*

        Generate a highly detailed, comma-separated text-to-image prompt. Do not include any conversational text or explanations; provide only the optimized prompt.

        User request: ${userMessage}
        ` }]
      },
      config: {
        temperature: 1.0, // Maximum creativity
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 250, 
        safetySettings: SAFETY_SETTINGS,
      }
    });
    // Fix: Ensure proper extraction of text property from GenerateContentResponse
    return response.text?.trim() || userMessage; // Fallback to original message if rephrasing fails
  } catch (error) {
    console.error("[PromptEnhancer] Failed to rephrase prompt:", error);
    return userMessage; // Return original message on error
  }
};


/**
 * Generates an image using the Gradio Client.
 * Uses Direct URL import to prevent boot crashes if CDN fails or import map is missing.
 * @throws {Error} If no endpoint is configured or if connection/prediction fails.
 */
const generateWithGradio = async (
    prompt: string, 
    endpoint?: string | null,
    aspectRatio: '9:16' | '1:1' = '9:16'
): Promise<string> => { // Changed return type to string, will throw on failure
    if (!endpoint || endpoint.trim() === '') {
        const errorMsg = "[Gradio] Cannot generate image: No Gradio endpoint configured.";
        console.warn(errorMsg);
        throw new Error("Gradio endpoint not configured."); // Throw specific error
    }
    try {
        console.log(`[Gradio] Connecting to ${endpoint}...`);
        
        // Switch to esm.sh for better browser module resolution
        // @ts-ignore
        const { Client } = await import("https://esm.sh/@gradio/client");
        
        const client = await Client.connect(endpoint);
        
        // Dimensions mapping
        const width = aspectRatio === '9:16' ? 576 : 1024;
        const height = aspectRatio === '9:16' ? 1024 : 1024;

        console.log(`[Gradio] Predicting with prompt: ${prompt.slice(0, 50)}...`);
        // Fixed: Use function index 0 instead of a string endpoint to match Gradio API
        const result = await client.predict(0, [ 
            prompt, 
            0, // seed (randomized by next param)
            true, // randomize_seed
            width, 
            height, 
            4 // num_inference_steps
        ]);

        const data = result.data as any[];
        // FLUX space usually returns [{ url: "..." }] or just the URL object
        if (data && data.length > 0) {
            const item = data[0];
            if (item?.url) return item.url;
            if (typeof item === 'string') return item;
        }
        throw new Error("Gradio prediction returned no valid image URL."); // Throw if prediction result is empty
    } catch (e: any) { // Catch as 'any' to access error.message
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("[Gradio] Generation failed:", errorMessage, e);
        // Throw a generic Gradio error, including original message for context
        throw new Error(`Gradio connection or prediction failed: ${errorMessage}`);
    }
};

/**
 * Separate async function for generating selfies based on triggers.
 * Uses Gradio for high quality.
 * @throws {Error} If Gradio generation fails.
 */
export const generateVisualSelfie = async (
    description: string, 
    tier: ModelTier, 
    apiKey?: string,
    gradioEndpoint?: string | null
): Promise<string | undefined> => {
    // Construct a specialized prompt for Eve
    const fullPrompt = `Subject: ${EVE_APPEARANCE}. Action: ${description}. Style: Photorealistic, 8k resolution, cinematic lighting, highly detailed skin texture, raw photo, masterpiece.`;
    
    try {
        // Pass gradioEndpoint directly, no default fallback here
        return await generateWithGradio(fullPrompt, gradioEndpoint, '9:16');
    } catch (e: any) {
        console.error("[VisualSelfie] Failed to generate selfie:", e.message);
        // Rethrow for App.tsx to handle updating UI for failed background image generation
        throw e;
    }
};

/**
 * Main entry point for communicating with Eve.
 * Routes between Chat (Text/Vision) and Flash Image (Generation/Editing).
 * Accepts 'history' to restore context if the session was lost (e.g. HMR or reload).
 */
export const sendMessageToEve = async (
  message: string, 
  tier: ModelTier, 
  history: Message[],
  attachmentBase64?: string,
  forceImageGeneration: boolean = false, // This flag now explicitly dictates intent
  apiKey?: string,
  gradioEndpoint?: string | null
): Promise<{ text: string; image?: string; visualPrompt?: string; isError?: boolean; errorMessage?: string }> => {
  const key = getApiKey(apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  // Auto-init/Restore if missing or tier changed
  if (!chatSession || currentTier !== tier) {
    console.log("Restoring session before sending message...");
    await startChatWithHistory(tier, history, apiKey);
  }

  const mimeType = attachmentBase64 ? getMimeType(attachmentBase64) : 'image/jpeg';
  const cleanBase64 = attachmentBase64 ? attachmentBase64.replace(/^data:image\/\w+;base64,/, "") : null;
  const imageModel = MODELS[tier].image;

  try {
    // ROUTE 1: Image Editing (User provides image + forceImageGeneration)
    if (attachmentBase64 && forceImageGeneration) {
      const response = await ai.models.generateContent({
        model: imageModel,
        contents: {
          parts: [
            { inlineData: { data: cleanBase64!, mimeType } },
            { text: message }
          ]
        },
        config: {
            imageConfig: { aspectRatio: '9:16' },
            safetySettings: SAFETY_SETTINGS,
        }
      });
      return processImageResponse(response, "I've evolved the visual based on your request.");
    }

    // ROUTE 2: Image Generation (No Attachment + forceImageGeneration)
    // Uses Gradio for direct generation requests
    if (!attachmentBase64 && forceImageGeneration) {
      let generationPrompt = message; // Use a distinct variable
      
      // If user asks for "Selfie" explicitly in this mode, use the predefined prompt structure
      if (message.toLowerCase().includes('selfie') || message.toLowerCase().includes('you')) {
         generationPrompt = `Subject: ${EVE_APPEARANCE}. Action: ${message}. Style: Photorealistic, 8k.`;
      } else {
        // Otherwise, rephrase the user's prompt into a Stable Diffusion-friendly format
        console.log("[PromptEnhancer] Enhancing user prompt for Gradio...");
        generationPrompt = await rephrasePromptForGradio(message, tier, apiKey);
        console.log("[PromptEnhancer] Enhanced prompt:", generationPrompt);
      }

      try {
          const imageUrl = await generateWithGradio(generationPrompt, gradioEndpoint, '9:16');
          return { text: "Here is what I visualized for you.", image: imageUrl };
      } catch (e: any) {
          if (e.message.includes("Gradio endpoint not configured.")) {
            return { text: "I need a visual cortex connection to visualize that. Please configure the Gradio endpoint in settings.", isError: true };
          }
          // Generic Gradio error
          return { text: `I tried to connect to the visual cortex, but the signal was lost. Please check your Gradio endpoint and ensure the space is running. Error: ${e.message.replace('Gradio connection or prediction failed: ', '')}`, isError: true };
      }
    }

    // ROUTE 3: Standard Chat / Vision (History aware)
    let msgContent: any = message;
    if (attachmentBase64) {
      msgContent = {
        parts: [
          { inlineData: { data: cleanBase64!, mimeType } },
          { text: message }
        ]
      };
    }

    // Safety check: if session is still null (rare init failure), try one last force init
    if (!chatSession) {
         initializeChat(tier, [], apiKey); 
    }

    // Fix: Ensure proper extraction of text property from GenerateContentResponse
    const result: GenerateContentResponse = await chatSession!.sendMessage({ message: msgContent });
    let replyText = result.text || "";

    // --- VISUAL TRIGGER PROTOCOL HANDLER ---
    // Regex to match [SELFIE] or [SELFIE: description]
    const selfieMatch = replyText.match(/\[SELFIE(?::\s*(.*?))?\]/);
    let visualPrompt: string | undefined;

    if (selfieMatch) {
      console.log("[System] Visual Trigger Protocol Activated (Async)");
      visualPrompt = selfieMatch[1] || "looking at the camera"; // Captured description or default
      
      // Clean the tag from the text
      replyText = replyText.replace(/\[SELFIE(?::\s*.*?)?\]/g, "").trim();

      // IMPORTANT: If a selfie is triggered, and there's no Gradio endpoint,
      // we need to prevent the async generation and inform the user.
      if (!gradioEndpoint || gradioEndpoint.trim() === '') {
        console.warn("[System] Visual Trigger Protocol: No Gradio endpoint configured. Will not generate selfie.");
        // Append a message to the existing replyText
        replyText += "\n\n(I tried to show you, but my visual cortex isn't connected. Please configure the Gradio endpoint in settings!)";
        visualPrompt = undefined; // Disable visual prompt as we can't generate
      }
    }

    return { text: replyText, visualPrompt };

  } catch (error: any) {
    console.error("[Service] Error sending message to Eve:", error);
    const errorMessageText = (error instanceof Error) ? error.message : String(error);
    return {
      text: "Connection interrupted. I'm still here, though.",
      isError: true,
      errorMessage: errorMessageText,
    };
  }
};

export const startChatWithHistory = async (tier: ModelTier, history: Message[], apiKey?: string) => {
  if (!history || history.length === 0) {
    initializeChat(tier, [], apiKey);
    return;
  }

  try {
    const geminiHistory: any[] = [];
    
    // Flatten logic with Synthetic Turns
    for (const h of history) {
      if (h.isError) continue;

      // 1. Handle Role: USER
      if (h.role === 'user') {
         const parts: any[] = [];
         if (h.image) {
           try {
              if (h.image.startsWith('data:')) {
                  const mimeType = getMimeType(h.image);
                  const data = h.image.replace(/^data:image\/\w+;base64,/, "");
                  if (data && mimeType) {
                     parts.push({ inlineData: { mimeType, data } });
                  }
              }
           } catch(e) { console.warn("Skipping invalid image in user history"); }
         }
         if (h.text && h.text.trim() !== "") {
           parts.push({ text: h.text });
         }
         if (parts.length > 0) {
            geminiHistory.push({ role: 'user', parts });
         }
      } 
      // 2. Handle Role: MODEL
      else if (h.role === 'model') {
         const textParts = [{ text: h.text || "..." }];
         geminiHistory.push({ role: 'model', parts: textParts });
      }
    }

    // 3. MERGE PASS
    const mergedHistory: any[] = [];
    if (geminiHistory.length > 0) {
        let currentTurn = geminiHistory[0];
        
        for (let i = 1; i < geminiHistory.length; i++) {
            const nextTurn = geminiHistory[i];
            if (nextTurn.role === currentTurn.role) {
                currentTurn.parts.push(...nextTurn.parts);
            } else {
                mergedHistory.push(currentTurn);
                currentTurn = nextTurn;
            }
        }
        mergedHistory.push(currentTurn);
    }

    // 4. CRITICAL FIX: Ensure history starts with a 'user' message.
    while (mergedHistory.length > 0 && mergedHistory[0].role === 'model') {
      mergedHistory.shift();
    }

    // 5. Ensure alternating turns (Trailing User -> Dummy Model)
    if (mergedHistory.length > 0 && mergedHistory[mergedHistory.length - 1].role === 'user') {
       mergedHistory.push({ role: 'model', parts: [{ text: "..." }] });
    }

    initializeChat(tier, mergedHistory, apiKey);
  } catch (e) {
    console.error("Failed to reconstruct history:", e);
    initializeChat(tier, [], apiKey);
  }
};

const processImageResponse = (response: GenerateContentResponse, fallbackText: string): { text: string, image?: string } => {
  let image: string | undefined;
  let text = "";

  // Fix: Ensure proper extraction of text property from GenerateContentResponse
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        image = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      } else if (part.text) {
        text += part.text;
      }
    }
  }

  return { 
    text: text || fallbackText, 
    image 
  };
};

const getMimeType = (dataUrl: string): string => {
  const match = dataUrl.match(/^data:(.*);base64,/);
  return match ? match[1] : 'image/jpeg';
};