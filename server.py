"""
Ara local server — audio capture, STT, Claude analysis, WebSocket broadcast.
Runs on ws://localhost:5000

Start: python server.py
Deps:  pip install -r requirements.txt
"""

import asyncio
import json
import os
import queue
import threading
import time
from datetime import datetime
from typing import Optional

import anthropic
import numpy as np
import pyaudio
import websockets
from dotenv import load_dotenv

load_dotenv(".env.local")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise RuntimeError("ANTHROPIC_API_KEY not found in .env.local")

aclient = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

# Audio config
SAMPLE_RATE = 16000
CHUNK = 1024
CHANNELS = 1
FORMAT = pyaudio.paInt16
SILENCE_THRESHOLD = 600       # RMS amplitude — raise if too sensitive
SILENCE_SECONDS = 1.8         # seconds of silence before flushing a phrase
CALL_DETECT_SECONDS = 0.6     # seconds of audio above threshold to trigger call_started
MIN_PHRASE_SECONDS = 0.4      # ignore very short bursts (< 0.4s)

# Shared state
connected_clients: set = set()
call_active = False
call_start_wall: Optional[float] = None
full_transcript: list[dict] = []
phrase_counter = 0
analysis_counter = 0
_loop: Optional[asyncio.AbstractEventLoop] = None
auto_shutdown_task: Optional[asyncio.Task] = None

AUTO_SHUTDOWN_SECONDS = 120  # exit this many seconds after call ends if no new call

# Thread → async bridge
event_queue: asyncio.Queue = None  # initialised in main()
audio_q: queue.Queue = queue.Queue(maxsize=200)


# ---------------------------------------------------------------------------
# Broadcast helpers
# ---------------------------------------------------------------------------

async def broadcast(data: dict):
    if not connected_clients:
        return
    msg = json.dumps(data)
    dead = set()
    for ws in list(connected_clients):
        try:
            await ws.send(msg)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


def broadcast_sync(data: dict):
    """Post a broadcast from a non-async thread."""
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_enqueue(data), _loop)


async def _enqueue(data: dict):
    await event_queue.put(data)


async def _auto_shutdown():
    await asyncio.sleep(AUTO_SHUTDOWN_SECONDS)
    print(f"[ara] No new call for {AUTO_SHUTDOWN_SECONDS}s — shutting down.")
    os._exit(0)


def _cancel_shutdown():
    global auto_shutdown_task
    if auto_shutdown_task and not auto_shutdown_task.done():
        auto_shutdown_task.cancel()
    auto_shutdown_task = None


def _schedule_shutdown():
    global auto_shutdown_task
    _cancel_shutdown()
    auto_shutdown_task = asyncio.ensure_future(_auto_shutdown())


# ---------------------------------------------------------------------------
# Audio capture thread (pyaudio → audio_q)
# ---------------------------------------------------------------------------

def audio_thread():
    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=FORMAT,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK,
    )
    print("[audio] Microphone open — listening…")
    try:
        while True:
            data = stream.read(CHUNK, exception_on_overflow=False)
            if not audio_q.full():
                audio_q.put(data)
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()


# ---------------------------------------------------------------------------
# VAD + STT loop (async, reads audio_q via executor)
# ---------------------------------------------------------------------------

def rms(data: bytes) -> float:
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32)
    return float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0


async def vad_stt_loop():
    global call_active, call_start_wall, phrase_counter

    voiced_frames: list[bytes] = []
    silent_frames = 0
    voiced_duration = 0.0  # seconds above threshold in current burst
    frames_per_sec = SAMPLE_RATE / CHUNK

    while True:
        try:
            chunk = await asyncio.get_event_loop().run_in_executor(
                None, lambda: audio_q.get(timeout=0.1)
            )
        except queue.Empty:
            continue

        level = rms(chunk)
        is_voiced = level > SILENCE_THRESHOLD

        if is_voiced:
            voiced_frames.append(chunk)
            voiced_duration += 1.0 / frames_per_sec
            silent_frames = 0

            # Trigger call_started after enough sustained audio
            if not call_active and voiced_duration >= CALL_DETECT_SECONDS:
                call_active = True
                call_start_wall = time.time()
                full_transcript.clear()
                phrase_counter = 0
                _cancel_shutdown()
                await event_queue.put({"type": "call_started"})
                print("[ara] call_started (auto-detected via VAD)")

        else:
            silent_frames += 1
            if voiced_frames:
                voiced_frames.append(chunk)  # include a little trailing silence

            silence_secs = silent_frames / frames_per_sec

            if voiced_frames and silence_secs >= SILENCE_SECONDS:
                phrase_audio = b"".join(voiced_frames)
                phrase_secs = len(voiced_frames) / frames_per_sec

                voiced_frames = []
                voiced_duration = 0.0
                silent_frames = 0

                if call_active and phrase_secs >= MIN_PHRASE_SECONDS:
                    asyncio.ensure_future(transcribe_and_analyse(phrase_audio))

    # silence without prior voiced — reset counter
    if not is_voiced and not voiced_frames:
        voiced_duration = 0.0


async def transcribe_and_analyse(audio_bytes: bytes):
    global phrase_counter, analysis_counter

    text = await asyncio.get_event_loop().run_in_executor(
        None, lambda: _transcribe_google(audio_bytes)
    )

    if not text:
        return

    phrase_counter += 1
    elapsed = int(time.time() - (call_start_wall or time.time()))
    time_str = f"{elapsed // 60:02d}:{elapsed % 60:02d}"

    line = {
        "id": phrase_counter,
        "time": time_str,
        "label": "Caller",
        "text": text,
    }
    full_transcript.append({"label": "Caller", "text": text})
    await event_queue.put({"type": "transcript", "line": line})

    # Fire Claude analysis without blocking
    asyncio.ensure_future(run_claude_analysis(list(full_transcript)))


def _transcribe_google(audio_bytes: bytes) -> str:
    """Synchronous Google STT via speech_recognition."""
    try:
        import speech_recognition as sr

        recognizer = sr.Recognizer()
        audio_data = sr.AudioData(audio_bytes, SAMPLE_RATE, 2)  # 16-bit = 2 bytes
        return recognizer.recognize_google(audio_data, language="en-NZ")
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Claude analysis
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are Ara, a real-time AI sales coach embedded in a debt collection/invoice follow-up call tool called Tradesflow. You receive the live call transcript and return brief, actionable coaching intelligence.

Respond ONLY with a single valid JSON object — no markdown, no commentary, no extra keys. Schema:
{
  "mood": "Warm|Neutral|Guarded|Resistant|Interested",
  "heat": <integer 1-10>,
  "instinct": "<under 10 words — what the agent should feel about where this is heading>",
  "feed_message": "<under 20 words — the single most useful thing to tell the agent right now>",
  "objection": null | {"text": "<brief label for the objection>", "response": "<how to handle it, under 20 words>"}
}"""


async def run_claude_analysis(transcript_lines: list[dict]):
    global analysis_counter

    if not transcript_lines:
        return

    transcript_text = "\n".join(
        f"{l['label']}: {l['text']}" for l in transcript_lines
    )

    try:
        response = await aclient.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=350,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Transcript:\n{transcript_text}",
                }
            ],
        )

        raw = response.content[0].text.strip()
        data = json.loads(raw)
    except Exception as e:
        print(f"[claude] analysis error: {e}")
        return

    analysis_counter += 1
    now = datetime.now().strftime("%H:%M")

    await event_queue.put(
        {
            "type": "radar_update",
            "mood": data.get("mood", "Neutral"),
            "heat": int(data.get("heat", 5)),
            "instinct": data.get("instinct", ""),
        }
    )

    feed_msg = data.get("feed_message", "")
    if feed_msg:
        await event_queue.put(
            {
                "type": "claude_feed",
                "message": {
                    "id": analysis_counter * 1000,
                    "time": now,
                    "text": feed_msg,
                },
            }
        )

    obj = data.get("objection")
    if obj and isinstance(obj, dict):
        await event_queue.put(
            {
                "type": "objection",
                "text": obj.get("text", ""),
                "response": obj.get("response", ""),
            }
        )


# ---------------------------------------------------------------------------
# Event broadcaster (drains event_queue → all WS clients)
# ---------------------------------------------------------------------------

async def event_broadcaster():
    while True:
        data = await event_queue.get()
        await broadcast(data)


# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------

async def ws_handler(websocket):
    global call_active, full_transcript, phrase_counter

    connected_clients.add(websocket)
    print(f"[ws] client connected ({len(connected_clients)} total)")

    # If a call is already in progress, catch this client up immediately
    if call_active:
        await websocket.send(json.dumps({"type": "call_started"}))

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "manual_start":
                call_active = True
                full_transcript.clear()
                phrase_counter = 0
                global call_start_wall
                call_start_wall = time.time()
                _cancel_shutdown()
                await event_queue.put({"type": "call_started"})
                print("[ara] call_started (manual)")

            elif msg.get("type") == "manual_end":
                call_active = False
                await event_queue.put({"type": "call_ended"})
                _schedule_shutdown()
                print("[ara] call_ended (manual)")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[ws] client disconnected ({len(connected_clients)} total)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    global _loop, event_queue
    _loop = asyncio.get_event_loop()
    event_queue = asyncio.Queue()

    # Start audio capture thread
    t = threading.Thread(target=audio_thread, daemon=True)
    t.start()

    print("[ara] Server starting on ws://localhost:5000")

    try:
        server = await websockets.serve(ws_handler, "localhost", 5000)
    except OSError:
        print("[ara] Port 5000 already in use — another instance is running, exiting.")
        return

    async with server:
        await asyncio.gather(
            vad_stt_loop(),
            event_broadcaster(),
        )


if __name__ == "__main__":
    asyncio.run(main())
