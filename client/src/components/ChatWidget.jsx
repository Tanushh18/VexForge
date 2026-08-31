import { useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";
import { useVoice } from "../hooks/useVoice.js";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [configured, setConfigured] = useState(true);
  const bodyRef = useRef(null);

  const { listening, supported, start, speak } = useVoice({
    onResult: (text) => {
      setInput(text);
      send(text);
    },
  });

  useEffect(() => {
    api.chatConfig().then((c) => setConfigured(c.configured)).catch(() => {});
    api.chatHistory().then((hist) => setMessages(hist.map((h) => ({ role: h.role, content: h.content })))).catch(() => {});
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [messages, open]);

  async function send(overrideText) {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const { reply } = await api.sendChat(text, next.slice(-10));
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (voiceOn) speak(reply);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button className="chat-launcher" onClick={() => setOpen(true)} title="Talk to Ember (Head Manager)">💬</button>;
  }

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="t">Ember · Head Manager</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="close" onClick={() => setVoiceOn((v) => !v)} title="Toggle spoken replies">{voiceOn ? "🔊" : "🔇"}</button>
          <button className="close" onClick={() => setOpen(false)}>✕</button>
        </div>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {!configured && (
          <div className="msg assistant">
            ANTHROPIC_API_KEY isn't set on the server yet — add it to server/.env to enable me. The rest of the
            app (dashboard, CRM, outreach, support) works fine without it.
          </div>
        )}
        {messages.length === 0 && configured && (
          <div className="msg assistant">Hey — I'm Ember, your Head Manager. Ask me for a company status, to check a department, list leads, or draft outreach.</div>
        )}
        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant">…thinking</div>}
      </div>
      <div className="chat-input">
        {supported && (
          <button className={`mic-btn ${listening ? "listening" : ""}`} onClick={start} title="Speak a command">🎤</button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask Ember something…"
          disabled={!configured}
        />
        <button className="send-btn" onClick={() => send()} disabled={!configured || busy}>Send</button>
      </div>
    </div>
  );
}
