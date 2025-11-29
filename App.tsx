import React, { useState, useEffect, useRef } from 'react';
import { sendMessageToEve, startChatWithHistory, generateVisualSelfie } from './services/geminiService';
import { saveSession, loadSession, clearSession, loadApiKeys, saveApiKeys, loadActiveKeyId, saveActiveKeyId, loadGradioEndpoint, saveGradioEndpoint } from './services/storageService';
import { Message, ModelTier, ApiKeyDef } from './types';
import ChatBubble from './components/ChatBubble';
import VisualAvatar from './components/VisualAvatar';

const App: React.FC = () => {
  // --- APP STATE ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>('free');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isImageEvolutionMode, setIsImageEvolutionMode] = useState(false); // New state for image evolution mode
  const [currentEmotion, setCurrentEmotion] = useState<'neutral' | 'happy' | 'cheeky' | 'angry' | 'smirking' | 'seductive'>('neutral');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // --- API KEY & SETTINGS STATE ---
  const [apiKeys, setApiKeys] = useState<ApiKeyDef[]>(() => loadApiKeys());
  const [activeKeyId, setActiveKeyId] = useState<string | null>(() => loadActiveKeyId());
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [showKeyManager, setShowKeyManager] = useState(false);
  
  // Gradio Endpoint State
  const [gradioEndpoint, setGradioEndpoint] = useState<string | null>(() => loadGradioEndpoint());
  const [tempGradioEndpoint, setTempGradioEndpoint] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null); 

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, attachment, isLoaded]);

  // --- HYDRATION (ASYNC STORAGE) ---
  useEffect(() => {
    const hydrate = async () => {
      console.log("[App] Attempting to hydrate session...");
      try {
        const session = await loadSession(); // No userId needed
        if (session && session.messages.length > 0) {
          setMessages(session.messages);
          setModelTier(session.tier);
          setLastSaved(new Date(session.lastUpdated));
          console.log(`[App] Hydration successful: Loaded ${session.messages.length} messages. Tier: ${session.tier}`);
        } else {
          console.log("[App] No existing session found or session is empty. Initializing welcome message.");
          setMessages([{
            id: 'welcome',
            role: 'model',
            text: `System Stable. Vault Storage Active (IndexedDB). Hello. I'm ready.`,
          }]);
        }
      } catch (e) {
        console.error("[App] Hydration failed during loadSession:", e);
        setMessages([{
          id: 'welcome_error',
          role: 'model',
          text: `Error loading session: ${e instanceof Error ? e.message : String(e)}. Starting fresh.`,
        }]);
      } finally {
        setIsLoaded(true);
        console.log("[App] Hydration process completed. setIsLoaded(true).");
      }
    };
    hydrate();
  }, []); // Run once on component mount

  // --- BRAIN CONNECTION ---
  useEffect(() => {
    if (isLoaded) { // Only depends on isLoaded now
      const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
      console.log(`[App] Initializing chat session: isLoaded=${isLoaded}, modelTier=${modelTier}, messages.length=${messages.length}, activeKeyId=${activeKeyId || 'default'}`);
      startChatWithHistory(modelTier, messages, activeKeyDef?.key);
    }
  }, [isLoaded, modelTier, messages, activeKeyId]); 

  // --- SAVE ON INTERACTION ---
  useEffect(() => {
    if (!isLoaded) {
      console.log("[App] Not saving: App not yet loaded.");
      return; 
    }
    
    const isDefaultWelcome = messages.length === 1 && messages[0].id === 'welcome';
    
    if (messages.length > 0 && !isDefaultWelcome) {
      console.log(`[App] Attempting to save session with ${messages.length} messages (tier: ${modelTier}).`);
      // Async save to IndexedDB (non-blocking)
      saveSession(messages, modelTier).then(() => { 
        setLastSaved(new Date());
        console.log("[App] Session saved successfully.");
      }).catch(err => console.error("[App] Session save failed:", err));
    } else {
      console.log("[App] Not saving: Messages array is empty or only contains default welcome message.");
    }
  }, [messages, modelTier, isLoaded]);

  // --- API KEY HANDLERS ---
  const handleAddKey = () => {
    if (!newKeyLabel.trim() || !newKeyValue.trim()) return;
    const newKey: ApiKeyDef = {
      id: Date.now().toString(),
      label: newKeyLabel.trim(),
      key: newKeyValue.trim()
    };
    const updatedKeys = [...apiKeys, newKey];
    setApiKeys(updatedKeys);
    saveApiKeys(updatedKeys);
    
    if (updatedKeys.length === 1) {
      setActiveKeyId(newKey.id);
      saveActiveKeyId(newKey.id);
    }

    setNewKeyLabel('');
    setNewKeyValue('');
    console.log("[App] API Key added.");
  };

  const handleDeleteKey = (id: string) => {
    const updatedKeys = apiKeys.filter(k => k.id !== id);
    setApiKeys(updatedKeys);
    saveApiKeys(updatedKeys);
    if (activeKeyId === id) {
      setActiveKeyId(null);
      saveActiveKeyId(null);
    }
    console.log(`[App] API Key ${id} deleted.`);
  };

  const handleSelectKey = (id: string | null) => {
    setActiveKeyId(id);
    saveActiveKeyId(id);
    console.log(`[App] Active API Key set to: ${id || 'default (Env)'}`);
  };

  // --- SETTINGS HANDLERS (Gradio) ---
  // Effect to pre-fill tempGradioEndpoint when settings are opened
  useEffect(() => {
    if (showSettings) {
      // Ensure tempGradioEndpoint is a string (even if gradioEndpoint is null)
      setTempGradioEndpoint(gradioEndpoint || ''); 
    } else {
      setTempGradioEndpoint(''); // Clear when settings are closed
    }
  }, [showSettings, gradioEndpoint]); // Depend on showSettings and gradioEndpoint

  const handleSaveGradioEndpoint = () => {
      const url = tempGradioEndpoint.trim(); // Save exactly what's typed, no default fallback
      setGradioEndpoint(url === '' ? null : url); // Store null if empty string
      saveGradioEndpoint(url);
      console.log(`[App] Saved Gradio Endpoint: ${url || 'None'}`);
      setTempGradioEndpoint(''); // Clear input after saving
  };

  const toggleTier = () => {
    const newTier = modelTier === 'free' ? 'pro' : 'free';
    setModelTier(newTier);
    console.log(`[App] Model tier toggled to: ${newTier}`);
  };

  const handleWipeMemory = async () => {
    if (window.confirm("Wipe the vault? This deletes all history permanently.")) {
      console.log("[App] Initiating vault wipe...");
      await clearSession(); // No userId needed
      
      const resetMsg: Message = {
        id: Date.now().toString(),
        role: 'model',
        text: `Vault cleared. Fresh session started.`,
      };
      
      setMessages([resetMsg]);
      setAttachment(null);
      setCurrentEmotion('neutral');
      
      const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
      startChatWithHistory(modelTier, [resetMsg], activeKeyDef?.key);
      setMobileMenuOpen(false);
      console.log("[App] Vault wiped and session reset.");
    }
  };

  // --- BACKUP & RESTORE HANDLERS ---
  const handleExportBackup = () => {
    const data = {
      messages,
      tier: modelTier,
      exportedAt: new Date().toISOString(),
      version: 'v2',
      // No user ID associated with backup now
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eve_backup_${new Date().toISOString().slice(0, 10)}.json`; // Simplified filename
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMobileMenuOpen(false);
    console.log("[App] Session exported to JSON backup.");
  };

  const handleImportBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (Array.isArray(json.messages)) {
          if (window.confirm(`Found backup with ${json.messages.length} messages from ${json.exportedAt || 'unknown date'}. Overwrite current session?`)) {
            setMessages(json.messages);
            if (json.tier) setModelTier(json.tier);
            
            // Save immediately to IDB as global session
            await saveSession(json.messages, json.tier || 'free');
            
            const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
            startChatWithHistory(json.tier || 'free', json.messages, activeKeyDef?.key);
            
            alert("Backup restored successfully.");
            setMobileMenuOpen(false);
            console.log("[App] Session imported from backup and restored.");
          }
        } else {
          alert("Invalid backup file format.");
          console.warn("[App] Invalid backup file format during import.");
        }
      } catch (err) {
        console.error("[App] Import failed", err);
        alert("Failed to parse backup file.");
      }
    };
    reader.readAsText(file);
    if (backupInputRef.current) backupInputRef.current.value = '';
  };


  // --- Handlers ---
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachment(e.target?.result as string);
        setIsImageEvolutionMode(true); // Automatically activate image evolution mode on attachment
        console.log(`[App] File selected for attachment: ${file.name}, size: ${file.size} bytes. Image evolution mode activated.`);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearAttachment = () => {
    setAttachment(null);
    console.log("[App] Attachment cleared.");
  };

  const toggleImageEvolutionMode = () => {
    setIsImageEvolutionMode(prev => !prev);
    console.log(`[App] Image Evolution Mode toggled to: ${!isImageEvolutionMode}`);
  };

  const detectEmotion = (text: string) => {
    const lower = text.toLowerCase();
    const happyMarkers = [
      '😊', '😁', '😄', '😃', '😂', '🤣', '😉', '😍', '🥰', '😘', '😋', '😎', 
      ':)', ':-)', ':d', 'lol', 'haha', 'hehe', 'love', 'fun', 'happy', 'good', 
      'great', 'excellent', 'amazing', 'sweet', 'banana'
    ];
    const cheekyMarkers = ['😏', 'tease', 'secret', 'maybe', 'hmmm', 'wink'];
    const angryMarkers = ['😠', '😡', '🤬', '😤', 'angry', 'mad', 'furious', 'annoying', 'stupid', 'idiot', 'hate', 'grr'];
    const evilMarkers = ['😈', '👿', '😼', 'evil', 'wicked', 'dark', 'plot', 'smirk', 'bad girl', 'trouble', 'chaos'];
    const seductiveMarkers = ['darling', 'honey', 'babe', 'come here', 'close', 'touch', 'kiss', 'lips', 'bed', 'naughty', 'desire', 'want you', 'hot', 'sexy', '😘', '💋', '🔥', '😻', '🥵'];

    if (seductiveMarkers.some(marker => lower.includes(marker))) {
        setCurrentEmotion('seductive');
    } else if (evilMarkers.some(marker => lower.includes(marker))) {
        setCurrentEmotion('smirking');
    } else if (angryMarkers.some(marker => lower.includes(marker))) {
       setCurrentEmotion('angry');
    } else if (happyMarkers.some(marker => lower.includes(marker))) {
      setCurrentEmotion('happy');
    } else if (cheekyMarkers.some(marker => lower.includes(marker))) {
      setCurrentEmotion('cheeky'); 
    } else {
      setCurrentEmotion('neutral');
    }
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !attachment) || isThinking) {
      console.log("[App] Send aborted: Input empty or already thinking.");
      return; 
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: inputText,
      image: attachment || undefined
    };

    setMessages((prev) => [...prev, userMsg]);
    console.log("[App] User message added to state.");
    
    const currentAttachment = attachment;
    const historySnapshot = messages; // Capture current messages for `startChatWithHistory`
    
    setInputText('');
    setAttachment(null);
    setIsThinking(true);
    setCurrentEmotion('neutral');
    console.log("[App] Resetting input, attachment, setting thinking state.");

    const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
    console.log(`[App] Sending message to Eve (Tier: ${modelTier}, Mode: ${isImageEvolutionMode ? 'Image Evolution' : 'Chat'}, HasAttachment: ${!!currentAttachment}).`);

    try {
      if (inputText.toLowerCase().includes('bananafy')) {
          document.body.style.borderColor = '#d946ef';
          console.log("[App] 'Bananafy' detected, changing body border color.");
      }

      const response = await sendMessageToEve(
        userMsg.text, 
        modelTier,
        historySnapshot,
        currentAttachment || undefined,
        isImageEvolutionMode, // Pass the new image evolution mode state
        activeKeyDef?.key,
        gradioEndpoint
      );
      
      // Handle the response from sendMessageToEve
      if (response.isError) {
        console.error("[App] Error received from Eve service:", response.errorMessage);
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          text: response.text, // "Connection interrupted. I'm still here, though."
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
        setCurrentEmotion('neutral'); // Reset emotion on error
        console.log("[App] Error message added to state.");
      } else {
        const messageId = (Date.now() + 1).toString();
        const eveMsg: Message = {
          id: messageId,
          role: 'model',
          text: response.text,
          image: response.image,
          isImageLoading: !!response.visualPrompt // Set true if a background generation is needed
        };

        setMessages((prev) => [...prev, eveMsg]);
        detectEmotion(response.text);
        console.log("[App] Eve's response received and added to state.");

        // Async Image Generation Trigger
        if (response.visualPrompt) {
            console.log(`[App] Triggering background visual generation: ${response.visualPrompt} using ${gradioEndpoint}`);
            generateVisualSelfie(response.visualPrompt, modelTier, activeKeyDef?.key, gradioEndpoint)
              .then((generatedImage) => {
                   if (generatedImage) {
                       setMessages(prev => prev.map(m => 
                          m.id === messageId 
                              ? { ...m, image: generatedImage, isImageLoading: false } 
                              : m
                       ));
                       console.log("[App] Background visual generation complete.");
                   } else {
                       setMessages(prev => prev.map(m => 
                          m.id === messageId ? { ...m, isImageLoading: false } : m
                       ));
                   }
              })
              .catch(err => {
                  console.error("[App] Background generation failed:", err);
                  setMessages(prev => prev.map(m => 
                      m.id === messageId ? { ...m, isImageLoading: false } : m
                  ));
              });
        }
      }

    } catch (error) { // This catch block now handles unexpected errors during the *service call itself* (e.g., network issues before reaching the service logic).
      console.error("[App] Unexpected error during message sending process:", error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "An unexpected error occurred. Please try again.", // Generic fallback for unexpected errors
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
      setCurrentEmotion('neutral'); // Reset emotion on unexpected error
      console.log("[App] Unexpected error message added to state.");
    } finally {
      setIsThinking(false);
      setIsImageEvolutionMode(false); // Reset image evolution mode after sending
      console.log("[App] Finished thinking state and reset image evolution mode.");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getPlaceholderText = () => {
    if (isThinking) {
        return "EVE is thinking...";
    }
    if (isImageEvolutionMode) {
        if (attachment) {
            return "Describe how to evolve this image...";
        }
        return "Describe the image EVE should visualize...";
    }
    return "Ask EVE anything...";
  };

  // Helper component for the sidebar content to reuse in mobile menu
  const SidebarContent = () => (
    <>
      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 text-xs text-slate-400 shadow-inner space-y-2">
        <div className="flex justify-between">
          <span>Vault Status</span>
          <span className="text-emerald-500">{isLoaded ? 'Active (IDB)' : 'Loading...'}</span>
        </div>

        <div className="flex justify-between border-t border-slate-800 pt-2">
          <span>Nodes Stored</span>
          <span className="text-purple-400 font-mono">{messages.length}</span>
        </div>

        <div className="flex justify-between border-t border-slate-800 pt-2">
          <span>Last Saved</span>
          <span className="text-slate-500">{lastSaved ? lastSaved.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}</span>
        </div>
        
        <div 
          className="flex justify-between items-center group cursor-pointer hover:bg-slate-800/50 p-1 -mx-1 rounded transition-colors border-t border-slate-800 pt-2"
          onClick={toggleTier}
          title="Click to switch Intelligence Tier"
        >
          <span>Model Tier</span>
          <div className="flex items-center gap-1.5">
            <span className={modelTier === 'pro' ? "text-fuchsia-500 font-bold" : "text-emerald-400"}>
              {modelTier === 'pro' ? 'Pro' : 'Core'}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-600 group-hover:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
        </div>
      </div>

      {/* SETTINGS (API KEY & GRADIO) */}
      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 text-xs text-slate-400 shadow-inner space-y-2">
         <div 
           className="flex justify-between items-center cursor-pointer" 
           onClick={() => setShowSettings(!showSettings)}
         >
            <span className="font-bold uppercase tracking-wide">Configuration</span>
            <span className="text-[10px]">{showSettings ? '▼' : '▶'}</span>
         </div>
         
         {showSettings && (
           <div className="animate-fade-in space-y-3 pt-2">
             
             {/* API KEYS SECTION */}
             <div className="space-y-1">
                 <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">API Keys</div>
                 {apiKeys.length > 0 && (
                   <div className="space-y-1 mb-2">
                     <div className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-900 cursor-pointer" onClick={() => handleSelectKey(null)}>
                        <div className={`w-2 h-2 rounded-full ${activeKeyId === null ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                        <span className={activeKeyId === null ? 'text-white' : 'text-slate-500'}>Default (Env)</span>
                     </div>
                     {apiKeys.map(k => (
                       <div key={k.id} className="flex items-center justify-between p-1.5 rounded hover:bg-slate-900 group">
                          <div className="flex items-center gap-2 cursor-pointer" onClick={() => handleSelectKey(k.id)}>
                            <div className={`w-2 h-2 rounded-full ${activeKeyId === k.id ? 'bg-fuchsia-500' : 'bg-slate-700'}`}></div>
                            <div className="flex flex-col">
                                <span className={activeKeyId === k.id ? 'text-white' : 'text-slate-500'}>{k.label}</span>
                                <span className="text-[9px] font-mono opacity-50">...{k.key.slice(-4)}</span>
                            </div>
                          </div>
                          <button onClick={() => handleDeleteKey(k.id)} className="text-slate-700 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                             ×
                          </button>
                       </div>
                     ))}
                   </div>
                 )}
                 <input 
                   type="text" 
                   placeholder="New Key Label" 
                   value={newKeyLabel}
                   onChange={(e) => setNewKeyLabel(e.target.value)}
                   className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white focus:border-fuchsia-500 outline-none mb-1"
                 />
                 <div className="flex gap-1">
                    <input 
                      type="password" 
                      placeholder="Paste Key" 
                      value={newKeyValue}
                      onChange={(e) => setNewKeyValue(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white focus:border-fuchsia-500 outline-none font-mono"
                    />
                    <button 
                      onClick={handleAddKey}
                      disabled={!newKeyLabel.trim() || !newKeyValue.trim()}
                      className="px-2 bg-slate-800 hover:bg-fuchsia-900 text-slate-400 hover:text-fuchsia-400 rounded text-[10px] transition-colors disabled:opacity-50"
                    >
                      +
                    </button>
                 </div>
             </div>

             {/* GRADIO CONFIG SECTION */}
             <div className="border-t border-slate-800 pt-2 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Visual Cortex (Gradio)</div>
                <div className="text-[9px] text-slate-600 mb-1 truncate" title={gradioEndpoint || 'None'}>Current: {gradioEndpoint || 'None'}</div>
                <div className="flex gap-1">
                    <input 
                      type="text" 
                      placeholder="Space ID or URL (e.g., user/model-name)" 
                      value={tempGradioEndpoint}
                      onChange={(e) => setTempGradioEndpoint(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white focus:border-fuchsia-500 outline-none font-mono"
                    />
                    <button 
                      onClick={handleSaveGradioEndpoint}
                      // Allow saving an empty string to clear the endpoint
                      disabled={false} 
                      className="px-2 bg-slate-800 hover:bg-emerald-900 text-slate-400 hover:text-emerald-400 rounded text-[10px] transition-colors"
                    >
                      Set
                    </button>
                </div>
             </div>

           </div>
         )}
      </div>

      <div className="mt-auto w-full space-y-3 pt-6 md:pt-0">
        <div className="grid grid-cols-2 gap-2">
          <button 
              onClick={handleExportBackup}
              className="py-2 text-[10px] bg-slate-800 hover:bg-fuchsia-900/30 text-slate-400 hover:text-fuchsia-400 transition-colors rounded border border-slate-700 hover:border-fuchsia-500/50 flex flex-col items-center gap-1"
          >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Backup
          </button>
          <button 
              onClick={() => backupInputRef.current?.click()}
              className="py-2 text-[10px] bg-slate-800 hover:bg-emerald-900/30 text-slate-400 hover:text-emerald-400 transition-colors rounded border border-slate-700 hover:border-emerald-500/50 flex flex-col items-center gap-1"
          >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m-4-4v12" />
              </svg>
              Restore
          </button>
          <input type="file" ref={backupInputRef} onChange={handleImportBackup} className="hidden" accept=".json" />
        </div>

        <button 
          onClick={handleWipeMemory}
          className="w-full py-2 text-xs text-slate-600 hover:text-red-400 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 border-t border-slate-800 pt-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Wipe Vault
        </button>
      </div>
    </>
  );

  if (!isLoaded) {
      return (
          <div className="flex h-screen w-full bg-[#0a0510] items-center justify-center text-slate-500">
              <div className="flex flex-col items-center gap-4">
                  <div className="w-8 h-8 border-2 border-fuchsia-500/50 border-t-fuchsia-500 rounded-full animate-spin"></div>
                  <span className="text-xs uppercase tracking-widest animate-pulse">Initializing Vault...</span>
              </div>
          </div>
      );
  }

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-full bg-[#0a0510] text-slate-200 overflow-hidden selection:bg-fuchsia-500/30">
      
      {/* --- LIGHTBOX OVERLAY --- */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 md:p-8 animate-fade-in cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <button 
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-2 bg-slate-900/50 rounded-full"
            onClick={() => setPreviewImage(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img 
            src={previewImage} 
            alt="Full Preview" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}

      {/* --- MOBILE HEADER --- */}
      <div className="fixed top-0 left-0 w-full h-16 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 z-50 flex items-center justify-between px-4 md:hidden shadow-lg overflow-visible">
        
        {/* Left: Branding */}
        <div className="z-10">
           <h1 className="text-sm font-serif font-bold tracking-tight text-slate-100">
             EVE <span className="text-fuchsia-500 text-[10px] align-top">v2.0</span>
           </h1>
        </div>

        {/* Center: Avatar Pop-out */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/3 z-50">
            <div className="transform scale-[2.0] origin-top drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)]">
               <VisualAvatar isThinking={isThinking} emotion={currentEmotion} />
            </div>
        </div>

        {/* Right: Menu Toggle */}
        <div className="z-10">
           <button 
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 text-slate-400 hover:text-fuchsia-500 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </div>

      {/* --- MOBILE MENU OVERLAY --- */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-xl p-6 md:hidden animate-fade-in flex flex-col">
          <div className="flex justify-end mb-8">
             <button 
               onClick={() => setMobileMenuOpen(false)}
               className="p-2 bg-slate-900 rounded-full text-slate-400 hover:text-white border border-slate-800"
             >
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
               </svg>
             </button>
          </div>
          <div className="flex-1">
             <h2 className="text-xl font-serif text-slate-200 mb-6 border-b border-slate-800 pb-2">Control Panel</h2>
             <SidebarContent />
          </div>
        </div>
      )}

      {/* --- DESKTOP SIDEBAR --- */}
      <div className="hidden md:flex md:h-screen md:w-80 md:flex-col md:border-r md:border-slate-800 md:p-8 shadow-2xl bg-slate-900/90 backdrop-blur-xl z-40">
        <div className="flex items-center gap-4 md:flex-col md:gap-8">
          <VisualAvatar isThinking={isThinking} emotion={currentEmotion} />
          <div className="text-left md:text-center">
            <h1 className="text-xl md:text-2xl font-serif font-bold tracking-tight text-slate-100">
              EVE <span className="text-fuchsia-500 text-xs align-top">v2.0</span>
            </h1>
            <p className="text-xs text-slate-500 tracking-widest uppercase">Evolutionary Virtual Entity</p>
          </div>
        </div>

        <div className="mt-8 flex-1 flex flex-col gap-6">
          <SidebarContent />
        </div>
      </div>

      {/* --- MAIN CHAT AREA --- */}
      <div className="flex-1 flex flex-col relative pt-16 md:pt-0 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 scroll-smooth min-h-0">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} onImageClick={setPreviewImage} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* --- INPUT AREA --- */}
        <div className="relative p-4 md:p-8 border-t border-slate-800 bg-slate-900/90 backdrop-blur-xl shadow-inner z-30">
          {attachment && (
            <div className="absolute -top-16 left-4 md:left-8 bg-slate-800/80 backdrop-blur-md p-2 rounded-lg flex items-center gap-2 shadow-lg animate-fade-in z-40">
              <img src={attachment} alt="Attachment Preview" className="h-12 w-12 object-cover rounded" />
              <span className="text-xs text-slate-400">Image Attached</span>
              <button onClick={clearAttachment} className="text-slate-500 hover:text-red-400 transition-colors p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-end gap-3 md:gap-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept="image/*"
            />
            {/* Attach Image Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-3 md:p-4 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-fuchsia-400 transition-colors flex-shrink-0"
              title="Attach Image"
              disabled={isThinking}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>

            {/* Image Evolution Mode Button */}
            <button
              onClick={toggleImageEvolutionMode}
              className={`p-3 md:p-4 rounded-full text-white transition-all flex-shrink-0 shadow-lg ${isThinking ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : isImageEvolutionMode ? 'bg-fuchsia-600 hover:bg-fuchsia-700 shadow-fuchsia-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-fuchsia-400'}`}
              title={isImageEvolutionMode ? "Image Evolution Mode: ON" : "Toggle Image Evolution Mode"}
              disabled={isThinking}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v.5c0 .28.22.5.5.5h3c.28 0 .5-.22.5-.5V15l5.79-5.81c.13.58.21 1.17.21 1.79 0 4.08-3.05 7.44-7 7.93V19h-1zm6.73-11.75l-4.73 4.73V13h-3v.98l-4.73-4.73C5.74 8.61 5.48 7.3 5.48 6c0-3.31 2.69-6 6-6s6 2.69 6 6c0 1.3-.26 2.61-.75 3.82z" />
              </svg>

            </button>

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={getPlaceholderText()}
              className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-3 md:p-4 text-sm md:text-base focus:outline-none focus:border-fuchsia-500/50 resize-none max-h-40 overflow-y-auto placeholder-slate-500 transition-colors"
              rows={1}
              disabled={isThinking}
            />

            <button
              onClick={handleSendMessage}
              className={`p-3 md:p-4 rounded-full text-white transition-all flex-shrink-0 shadow-lg 
                ${(!inputText.trim() && !attachment) || isThinking
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:shadow-fuchsia-500/30 active:scale-95'
                }`
              }
              title="Send Message"
              disabled={(!inputText.trim() && !attachment) || isThinking}
            >
              {isThinking ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;