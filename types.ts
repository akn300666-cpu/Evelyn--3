
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  image?: string; // Base64 string for images displayed in chat
  isError?: boolean;
  isImageLoading?: boolean;
}

export type ModelTier = 'free' | 'pro';

export interface EveConfig {
  voiceEnabled: boolean;
  personality: 'default' | 'bananafy';
}

export interface ApiKeyDef {
  id: string;
  label: string;
  key: string;
}