"use client";
import { useState, useEffect, useRef } from "react";

export type CallerIntel = {
  rowNumber: number;
  name: string;
  tradeType: string;
  phone: string;
  region: string;
  invoiceAmount?: string;
  daysOverdue?: number;
  attempts: number;
  lastCall: string;
};

export type ClaudeFeedMessage = {
  id: number;
  time: string;
  text: string;
};

export type TranscriptLine = {
  id: number;
  time: string;
  label: string;
  text: string;
};

export type Objection = { text: string; response: string } | null;

type Props = {
  isOpen: boolean;
  isLive: boolean;
  callerIntel: CallerIntel;
  claudeFeed: ClaudeFeedMessage[];
  transcript: TranscriptLine[];
  mood: string;
  heat: number;
  instinct: string;
  objection: Objection;
  onSaveAndNext: (notes: string) => void;
  onSaveOnly: (notes: string) => void;
  onEndCall: () => void;
};

const moodColors: Record<string, { bg: string; text: string; bar: string }> = {
  Warm: { bg: "#e8f5e9", text: "#2e7d32", bar: "#4caf50" },
  Neutral: { bg: "#fff8e1", text: "#f57f17", bar: "#ffc107" },
  Guarded: { bg: "#fff3e0", text: "#e65100", bar: "#ff9800" },
  Resistant: { bg: "#fce4ec", text: "#b71c1c", bar: "#ef5350" },
  Interested: { bg: "#e3f2fd", text: "#0d47a1", bar: "#2196f3" },
};

export default function AraCockpit({
  isOpen,
  isLive,
  callerIntel,
  claudeFeed,
  transcript,
  mood,
  heat,
  instinct,
  objection,
  onSaveAndNext,
  onSaveOnly,
  onEndCall,
}: Props) {
  const [notes, setNotes] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [newMessageId, setNewMessageId] = useState<number | null>(null);
  const [prevFeedLength, setPrevFeedLength] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const moodStyle = moodColors[mood] || moodColors.Neutral;

  useEffect(() => {
    if (isOpen) {
      setNotes("");
      setCallDuration(0);
      setPrevFeedLength(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isLive) {
      timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLive]);

  useEffect(() => {
    if (claudeFeed.length > prevFeedLength && claudeFeed[0]) {
      setNewMessageId(claudeFeed[0].id);
      setPrevFeedLength(claudeFeed.length);
      setTimeout(() => setNewMessageId(null), 1000);
    }
  }, [claudeFeed, prevFeedLength]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const formatDuration = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        transform: isOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-dm-sans), sans-serif",
          background: "#f5f4ef",
          minHeight: "100vh",
          padding: "0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top Bar — Caller Intel */}
        <div
          style={{
            background: "#ffffff",
            borderBottom: "1px solid #e8e6df",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                background: "#1a237e",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: "700",
                letterSpacing: "0.5px",
                flexShrink: 0,
              }}
            >
              {callerIntel.name
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")}
            </div>
            <div>
              <div
                style={{ fontWeight: "700", fontSize: "15px", color: "#1a1a1a" }}
              >
                {callerIntel.name}
              </div>
              <div
                style={{ fontSize: "12px", color: "#666", marginTop: "1px" }}
              >
                {callerIntel.tradeType}
                {callerIntel.region ? ` · ${callerIntel.region}` : ""}
              </div>
            </div>
          </div>

          <div
            style={{ display: "flex", gap: "24px", alignItems: "center" }}
          >
            <Stat
              label="PHONE"
              value={callerIntel.phone || "—"}
              accent="#444"
            />
            <Stat
              label="INVOICE"
              value={callerIntel.invoiceAmount || "—"}
              accent="#1a237e"
            />
            <Stat
              label="OVERDUE"
              value={callerIntel.daysOverdue ? `${callerIntel.daysOverdue} days` : "—"}
              accent="#c62828"
            />
            <Stat
              label="ATTEMPTS"
              value={String(callerIntel.attempts)}
              accent="#444"
            />
            <Stat
              label="LAST CALL"
              value={callerIntel.lastCall || "—"}
              accent="#444"
            />
          </div>

          <div
            style={{ display: "flex", alignItems: "center", gap: "12px" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: isLive ? "#e8f5e9" : "#f5f5f5",
                border: `1px solid ${isLive ? "#a5d6a7" : "#ddd"}`,
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: "600",
                color: isLive ? "#2e7d32" : "#999",
              }}
            >
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: isLive ? "#43a047" : "#bbb",
                  animation: isLive ? "pulse 1.5s infinite" : "none",
                }}
              />
              {isLive ? `LIVE  ${formatDuration(callDuration)}` : "ENDED"}
            </div>

            <button
              onClick={onEndCall}
              style={{
                background: isLive ? "#c62828" : "#e0e0e0",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {isLive ? "End Call" : "Call Ended"}
            </button>
          </div>
        </div>

        {/* Radar Bar */}
        <div
          style={{
            background: moodStyle.bg,
            borderBottom: `2px solid ${moodStyle.bar}22`,
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: "700",
              letterSpacing: "1px",
              color: "#999",
              textTransform: "uppercase",
            }}
          >
            Radar
          </div>

          <div
            style={{
              background: moodStyle.bg,
              border: `1px solid ${moodStyle.bar}44`,
              borderRadius: "20px",
              padding: "4px 14px",
              fontSize: "13px",
              fontWeight: "700",
              color: moodStyle.text,
            }}
          >
            {mood}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flex: 1,
              maxWidth: "200px",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "6px",
                background: "#e0e0e0",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${heat * 10}%`,
                  height: "100%",
                  background: moodStyle.bar,
                  borderRadius: "3px",
                  transition: "width 0.6s ease",
                }}
              />
            </div>
            <span
              style={{
                fontSize: "12px",
                fontWeight: "700",
                color: moodStyle.text,
                minWidth: "32px",
              }}
            >
              {heat}/10
            </span>
          </div>

          <div
            style={{
              fontSize: "13px",
              color: "#444",
              fontStyle: "italic",
            }}
          >
            &ldquo;{instinct}&rdquo;
          </div>

          {objection && (
            <div
              style={{
                marginLeft: "auto",
                background: "#fff8e1",
                border: "1px solid #ffe082",
                borderRadius: "8px",
                padding: "6px 14px",
                fontSize: "12px",
                color: "#e65100",
                maxWidth: "340px",
              }}
            >
              <span style={{ fontWeight: "700" }}>
                ⚠ {objection.text} —{" "}
              </span>
              {objection.response}
            </div>
          )}
        </div>

        {/* Main Content */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            padding: "16px 24px",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Claude Feed */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              border: "1px solid #e8e6df",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #f0ede6",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#4caf50",
                  boxShadow: "0 0 0 2px #c8e6c9",
                }}
              />
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  letterSpacing: "1px",
                  color: "#999",
                  textTransform: "uppercase",
                }}
              >
                Claude Feed
              </span>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {claudeFeed.length === 0 && (
                <div
                  style={{
                    fontSize: "13px",
                    color: "#bbb",
                    fontStyle: "italic",
                    padding: "8px",
                  }}
                >
                  Waiting for the call to start…
                </div>
              )}
              {claudeFeed.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    background:
                      msg.id === newMessageId ? "#e8f5e9" : "#fafaf8",
                    border: `1px solid ${
                      msg.id === newMessageId ? "#a5d6a7" : "#f0ede6"
                    }`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    transition: "background 0.5s ease, border 0.5s ease",
                    animation:
                      msg.id === newMessageId ? "slideIn 0.3s ease" : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      fontWeight: "700",
                      color: "#bbb",
                      letterSpacing: "0.5px",
                      marginBottom: "4px",
                    }}
                  >
                    {msg.time}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#333",
                      lineHeight: "1.5",
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Transcript */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              border: "1px solid #e8e6df",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #f0ede6",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#2196f3",
                  boxShadow: "0 0 0 2px #bbdefb",
                }}
              />
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  letterSpacing: "1px",
                  color: "#999",
                  textTransform: "uppercase",
                }}
              >
                Live Transcript
              </span>
            </div>

            <div
              ref={transcriptRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {transcript.length === 0 && (
                <div
                  style={{
                    fontSize: "13px",
                    color: "#bbb",
                    fontStyle: "italic",
                    padding: "8px",
                  }}
                >
                  Transcript will appear here…
                </div>
              )}
              {transcript.map((line) => (
                <div
                  key={line.id}
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#bbb",
                      fontWeight: "600",
                      minWidth: "36px",
                      paddingTop: "2px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {line.time}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: line.label === "Pouroa" ? "#1a237e" : "#c62828",
                      minWidth: "52px",
                      paddingTop: "2px",
                    }}
                  >
                    {line.label}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "#333",
                      lineHeight: "1.5",
                    }}
                  >
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Notes + Save */}
        <div
          style={{
            background: "#ffffff",
            borderTop: "1px solid #e8e6df",
            padding: "16px 24px",
            display: "flex",
            gap: "12px",
            alignItems: "flex-end",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: "700",
                letterSpacing: "1px",
                color: "#999",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Notes from this call
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened? Any objections, commitments, or follow-up context..."
              style={{
                width: "100%",
                minHeight: "72px",
                border: "1px solid #e0ddd6",
                borderRadius: "8px",
                padding: "10px 14px",
                fontSize: "13px",
                color: "#333",
                fontFamily: "inherit",
                resize: "vertical",
                background: "#fafaf8",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <button
              onClick={() => onSaveOnly(notes)}
              style={{
                background: "#ffffff",
                border: "1px solid #e0ddd6",
                borderRadius: "8px",
                padding: "10px 20px",
                fontSize: "13px",
                fontWeight: "600",
                color: "#666",
                cursor: "pointer",
              }}
            >
              Save only
            </button>
            <button
              onClick={() => onSaveAndNext(notes)}
              style={{
                background: "#1a237e",
                border: "none",
                borderRadius: "8px",
                padding: "10px 20px",
                fontSize: "13px",
                fontWeight: "600",
                color: "white",
                cursor: "pointer",
              }}
            >
              Save & Next →
            </button>
          </div>
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(-6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        `}</style>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: "10px",
          fontWeight: "700",
          letterSpacing: "1px",
          color: "#bbb",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: "700",
          color: accent,
          marginTop: "2px",
        }}
      >
        {value}
      </div>
    </div>
  );
}
