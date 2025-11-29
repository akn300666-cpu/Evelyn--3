
import { Message, ModelTier, ApiKeyDef } from '../types';

const DB_NAME = 'EveVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const GLOBAL_SESSION_KEY = 'global_session'; // Fixed key for the single session

const KEYS_STORAGE_KEY = 'eve_api_keys';
const ACTIVE_KEY_ID_STORAGE_KEY = 'eve_active_key_id';
const GRADIO_URL_STORAGE_KEY = 'eve_gradio_url';

interface StoredSession {
  messages: Message[];
  tier: ModelTier;
  lastUpdated: number;
}

// --- INDEXEDDB HELPERS ---

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    console.log("[IDB] Attempting to open IndexedDB:", DB_NAME, "v", DB_VERSION);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // DO NOT MODIFY: Fixes error "Property 'error' does not exist on type 'EventTarget'."
    request.onerror = (event: Event) => {
      const req = event.target as IDBRequest;
      console.error("[IDB] IndexedDB open error:", req.error);
      reject(req.error);
    };
    request.onsuccess = () => {
      console.log("[IDB] IndexedDB opened successfully.");
      resolve(request.result);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        console.log("[IDB] Creating object store:", STORE_NAME);
        db.createObjectStore(STORE_NAME, { keyPath: 'id' }); // Use 'id' as keyPath for a single entry
      }
    };
  });
};

export const saveSession = async (messages: Message[], tier: ModelTier = 'free') => {
  console.log(`[IDB] Attempting to save session with key '${GLOBAL_SESSION_KEY}' and ${messages.length} messages.`);
  try {
    const db = await initDB();
    const data = { id: GLOBAL_SESSION_KEY, messages, tier, lastUpdated: Date.now() };
    
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      transaction.oncomplete = () => {
        console.log(`[IDB] Session transaction for key '${GLOBAL_SESSION_KEY}' completed.`);
        resolve();
      };
      // DO NOT MODIFY: Fixes error "Property 'error' does not exist on type 'EventTarget'."
      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        console.error(`[IDB] Session transaction for key '${GLOBAL_SESSION_KEY}' failed:`, tx.error);
        reject(tx.error);
      };

      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data);
      request.onsuccess = () => console.log(`[IDB] Data put for key '${GLOBAL_SESSION_KEY}' successful.`);
      // DO NOT MODIFY: Fixes error "Property 'error' does not exist on type 'EventTarget'."
      request.onerror = (event: Event) => {
        const req = event.target as IDBRequest;
        console.error(`[IDB] Data put for key '${GLOBAL_SESSION_KEY}' failed:`, req.error);
      };
    });
  } catch (e) {
    console.error("[IDB] Failed to save session to IndexedDB:", e);
    throw e; // Re-throw to propagate error for App.tsx to catch
  }
};

export const loadSession = async (): Promise<StoredSession | null> => {
  console.log(`[IDB] Attempting to load session for key '${GLOBAL_SESSION_KEY}'.`);
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      transaction.oncomplete = () => console.log(`[IDB] Load transaction for key '${GLOBAL_SESSION_KEY}' completed.`);
      // DO NOT MODIFY: Fixes error "Property 'error' does not exist on type 'EventTarget'."
      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        console.error(`[IDB] Load transaction for key '${GLOBAL_SESSION_KEY}' failed:`, tx.error);
        reject(tx.error);
      };

      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(GLOBAL_SESSION_KEY); // Get using fixed key
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`[IDB] Loaded session data for key '${GLOBAL_SESSION_KEY}':`, result);
          resolve(result as StoredSession);
        } else {
          console.log(`[IDB] No session data found for key '${GLOBAL_SESSION_KEY}'.`);
          resolve(null);
        }
      };
      // DO NOT MODIFY: Fixes error "Property 'error' does not exist on type 'EventTarget'."
      request.onerror = (event: Event) => {
        const req = event.target as IDBRequest;
        console.error(`[IDB] Data get for key '${GLOBAL_SESSION_KEY}' failed:`, req.error);
      };
    });
  } catch (e) {
    console.error("[IDB] Failed to load from IndexedDB:", e);
    return null;
  }
};

export const clearSession = async () => {
  console.log(`[IDB] Attempting to clear session for key '${GLOBAL_SESSION_KEY}'.`);
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    transaction.oncomplete = () => console.log(`[IDB] Clear transaction for key '${GLOBAL_SESSION_KEY}' completed.`);
    // DO NOT MODIFY: Fixes error "Property 'error' does not exist on type 'EventTarget'."
    transaction.onerror = (event: Event) => {
      const tx = event.target as IDBTransaction;
      console.error(`[IDB] Clear transaction for key '${GLOBAL_SESSION_KEY}' failed:`, tx.error);
    };

    const store = transaction.objectStore(STORE_NAME);
    store.delete(GLOBAL_SESSION_KEY);
    
    console.log("[IDB] Vault cleared successfully.");
  } catch (e) {
    console.error("[IDB] Failed to clear session", e);
    throw e;
  }
};

export const restoreFromBackup = async (data: StoredSession): Promise<void> => {
  console.log("[IDB] Restoring session from backup.");
  await saveSession(data.messages, data.tier);
};

// --- API KEY MANAGEMENT (Keep in LocalStorage for sync access) ---

export const saveApiKeys = (keys: ApiKeyDef[]) => {
  try {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
    console.log("[Storage] API keys saved to localStorage.");
  } catch (e) {
    console.error("[Storage] Failed to save API keys to localStorage", e);
  }
};

export const loadApiKeys = (): ApiKeyDef[] => {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    const keys = raw ? JSON.parse(raw) : [];
    console.log(`[Storage] Loaded ${keys.length} API keys from localStorage.`);
    return keys;
  } catch (e) {
    console.error("[Storage] Failed to load API keys from localStorage", e);
    return [];
  }
};

export const saveActiveKeyId = (id: string | null) => {
  if (id) {
    localStorage.setItem(ACTIVE_KEY_ID_STORAGE_KEY, id);
    console.log(`[Storage] Active API key ID '${id}' saved to localStorage.`);
  } else {
    localStorage.removeItem(ACTIVE_KEY_ID_STORAGE_KEY);
    console.log("[Storage] Active API key ID removed from localStorage.");
  }
};

export const loadActiveKeyId = (): string | null => {
  const id = localStorage.getItem(ACTIVE_KEY_ID_STORAGE_KEY);
  console.log(`[Storage] Loaded active API key ID from localStorage: ${id || 'none'}.`);
  return id;
};

// --- GRADIO ENDPOINT STORAGE ---

export const saveGradioEndpoint = (url: string) => {
  try {
    // Save empty string if cleared, not null, to avoid localStorage converting null to "null" string
    localStorage.setItem(GRADIO_URL_STORAGE_KEY, url.trim()); 
    console.log(`[Storage] Gradio endpoint saved: ${url || 'None'}`);
  } catch (e) {
    console.error("[Storage] Failed to save Gradio endpoint", e);
  }
};

export const loadGradioEndpoint = (): string | null => {
  try {
    const url = localStorage.getItem(GRADIO_URL_STORAGE_KEY);
    // Convert empty string from storage to null for consistent state management
    return url === '' ? null : url;
  } catch (e) {
    console.error("[Storage] Failed to load Gradio endpoint", e);
    return null;
  }
};
