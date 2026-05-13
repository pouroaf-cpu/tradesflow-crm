"""
Ara local server — audio capture, STT, Claude analysis, WebSocket broadcast.
Runs on ws://localhost:5000

Start: start_ara.bat  (or: pythonw server.py)
Deps:  pip install -r requirements.txt
"""

import asyncio
import json
import os
import queue
import re
import sys
import threading
import time
from datetime import datetime
from typing import Optional

import aiohttp
import anthropic
import numpy as np
import pyaudio
import websockets
from dotenv import load_dotenv

# Redirect all output to a log file — pythonw.exe has no console
_log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ara-server.log')
_log_file = open(_log_path, 'a', buffering=1)
sys.stdout = _log_file
sys.stderr = _log_file

print(f"\n{'='*50}", flush=True)
print(f"=== SESSION START {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
print(f"{'='*50}", flush=True)

load_dotenv(".env.local")

import torch
import whisper as _whisper_lib
_whisper_device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[whisper] Using device: {_whisper_device}", flush=True)
print("[whisper] Loading model: large-v3-turbo...")
_whisper_model = _whisper_lib.load_model("large-v3-turbo", device=_whisper_device)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise RuntimeError("ANTHROPIC_API_KEY not found in .env.local")

aclient = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

# Audio config
SAMPLE_RATE = 16000
CHUNK = 1024
CHANNELS = 1
FORMAT = pyaudio.paInt16
SILENCE_THRESHOLD = 500       # RMS amplitude — raise if too sensitive
SILENCE_SECONDS = 0.8         # seconds of silence before flushing a phrase
CALL_DETECT_SECONDS = 0.5     # seconds of audio above threshold to trigger call_started
MIN_PHRASE_SECONDS = 0.4      # ignore very short bursts
MAX_PHRASE_SECONDS = 4        # force flush long monologues even without silence
MIN_PHRASE_BYTES = 12800      # 0.4 s × 16 000 Hz × 2 bytes — hard floor before queuing

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
audio_q_pou: queue.Queue = queue.Queue(maxsize=200)
audio_q_them: queue.Queue = queue.Queue(maxsize=200)


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
# Audio capture threads (pyaudio → per-speaker queues)
# ---------------------------------------------------------------------------

_pa_init_lock = threading.Lock()  # serialise Pa_Initialize across threads


def _find_device_index(pa: pyaudio.PyAudio, name_substr: str) -> Optional[int]:
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if name_substr.lower() in info["name"].lower() and info["maxInputChannels"] > 0:
            return i
    return None


def audio_thread_pou():
    try:
        with _pa_init_lock:
            pa = pyaudio.PyAudio()
        idx = _find_device_index(pa, "Razer")
        if idx is not None:
            print(f"[audio/pou] Using device index {idx}: {pa.get_device_info_by_index(idx)['name']}")
        else:
            idx = 1
            print(f"[audio/pou] Razer not found — falling back to device index {idx}: {pa.get_device_info_by_index(idx)['name']}")
        try:
            stream = pa.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=SAMPLE_RATE,
                input=True,
                input_device_index=idx,
                frames_per_buffer=CHUNK,
            )
        except Exception:
            import traceback
            traceback.print_exc()
            pa.terminate()
            return
        try:
            while True:
                data = stream.read(CHUNK, exception_on_overflow=False)
                if not audio_q_pou.full():
                    audio_q_pou.put(data)
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()
    except Exception:
        import traceback
        print("[audio/pou] FATAL exception in audio thread:", flush=True)
        traceback.print_exc()


def audio_thread_them():
    try:
        with _pa_init_lock:
            pa = pyaudio.PyAudio()
        idx = _find_device_index(pa, "CABLE Output")
        if idx is not None:
            print(f"[audio/them] Using device index {idx}: {pa.get_device_info_by_index(idx)['name']}")
        else:
            idx = 0
            print(f"[audio/them] CABLE Output not found — falling back to device index {idx}: {pa.get_device_info_by_index(idx)['name']}")
        try:
            stream = pa.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=SAMPLE_RATE,
                input=True,
                input_device_index=idx,
                frames_per_buffer=CHUNK,
            )
        except Exception:
            import traceback
            traceback.print_exc()
            pa.terminate()
            return
        try:
            while True:
                data = stream.read(CHUNK, exception_on_overflow=False)
                if not audio_q_them.full():
                    audio_q_them.put(data)
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()
    except Exception:
        import traceback
        print("[audio/them] FATAL exception in audio thread:", flush=True)
        traceback.print_exc()


# ---------------------------------------------------------------------------
# VAD + STT loops (async, one per speaker)
# ---------------------------------------------------------------------------

def rms(data: bytes) -> float:
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32)
    return float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0


async def _vad_stt_loop(q: queue.Queue, label: str):
    global call_active, call_start_wall, phrase_counter

    voiced_frames: list[bytes] = []
    silent_frames = 0
    voiced_duration = 0.0
    frames_per_sec = SAMPLE_RATE / CHUNK
    loop = asyncio.get_running_loop()
    prev_voiced = False

    while True:
        try:
            chunk = await loop.run_in_executor(
                None, lambda: q.get(timeout=0.1)
            )
        except queue.Empty:
            continue
        except asyncio.CancelledError:
            # CancelledError at the executor await is a stray cancellation
            # (e.g. Python 3.11 cancel counter firing after a previous swallow).
            # Don't let it kill the loop — just poll the queue again.
            continue

        level = rms(chunk)
        is_voiced = level > SILENCE_THRESHOLD

        # Log only on voiced frames or on state transitions — suppress silent steady-state
        if is_voiced or is_voiced != prev_voiced:
            print(f"[audio/{label}] RMS={level:.0f}  voiced={is_voiced}  call_active={call_active}")
        prev_voiced = is_voiced

        if is_voiced:
            voiced_frames.append(chunk)
            voiced_duration += 1.0 / frames_per_sec
            silent_frames = 0

            if not call_active and voiced_duration >= CALL_DETECT_SECONDS:
                call_active = True
                call_start_wall = time.time()
                full_transcript.clear()
                phrase_counter = 0
                _cancel_shutdown()
                try:
                    await event_queue.put({"type": "call_started"})
                except asyncio.CancelledError:
                    pass
                print(f"[ara] call_started (auto-detected via VAD on {label})")

            if call_active and voiced_duration >= MAX_PHRASE_SECONDS:
                phrase_audio = b"".join(voiced_frames)
                phrase_secs = voiced_duration
                voiced_frames = []
                voiced_duration = 0.0
                silent_frames = 0
                if len(phrase_audio) >= MIN_PHRASE_BYTES:
                    print(f"[stt/{label}] max phrase length reached — forcing flush at {phrase_secs:.1f}s", flush=True)
                    asyncio.ensure_future(transcribe_and_analyse(phrase_audio, label))

        else:
            silent_frames += 1
            if voiced_frames:
                voiced_frames.append(chunk)

            silence_secs = silent_frames / frames_per_sec

            if voiced_frames and silence_secs >= SILENCE_SECONDS:
                phrase_audio = b"".join(voiced_frames)
                phrase_secs = len(voiced_frames) / frames_per_sec

                voiced_frames = []
                voiced_duration = 0.0
                silent_frames = 0

                if call_active and phrase_secs >= MIN_PHRASE_SECONDS:
                    if len(phrase_audio) < MIN_PHRASE_BYTES:
                        print(f"[stt/{label}] buffer too short — {len(phrase_audio)} bytes, skipping")
                    else:
                        print(f"[stt/{label}] flushing phrase — {phrase_secs:.1f}s, {len(phrase_audio)} bytes")
                        asyncio.ensure_future(transcribe_and_analyse(phrase_audio, label))

        if not is_voiced and not voiced_frames:
            voiced_duration = 0.0


async def vad_stt_loop_pou():
    await _vad_stt_loop(audio_q_pou, "Pou")


async def vad_stt_loop_them():
    await _vad_stt_loop(audio_q_them, "Them")


async def transcribe_and_analyse(audio_bytes: bytes, label: str):
    global phrase_counter, analysis_counter

    # Secondary guard — vad_stt_loop already checks MIN_PHRASE_BYTES, but
    # protect against any direct calls with undersized buffers.
    if len(audio_bytes) < MIN_PHRASE_BYTES:
        print(f"[stt/{label}] buffer too short — {len(audio_bytes)} bytes, skipping")
        return

    text = await asyncio.get_running_loop().run_in_executor(
        None, lambda: _transcribe_google(audio_bytes)
    )

    if not text:
        print(f"[stt/{label}] empty result — no speech detected")
        return

    print(f"[stt/{label}] transcribed: \"{text}\"")

    phrase_counter += 1
    elapsed = int(time.time() - (call_start_wall or time.time()))
    time_str = f"{elapsed // 60:02d}:{elapsed % 60:02d}"

    line = {
        "id": phrase_counter,
        "time": time_str,
        "label": label,
        "text": text,
    }
    full_transcript.append({"label": label, "text": text})
    await event_queue.put({"type": "transcript", "line": line})

    # Fire Claude analysis without blocking
    asyncio.ensure_future(run_claude_analysis(list(full_transcript)))


def _transcribe_google(audio_bytes: bytes) -> str:
    try:
        import tempfile
        import soundfile as sf
        import numpy as np

        samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            sf.write(f.name, samples, SAMPLE_RATE)
            result = _whisper_model.transcribe(f.name, language='en', temperature=0, fp16=False, initial_prompt="This is a New Zealand sales call.")
            return result['text'].strip()
    except Exception as e:
        print(f"[stt] error: {e}")
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
  "objection": null | {"text": "<brief label for the objection>", "response": "<how to handle it, under 20 words>"},
  "name_detected": null | "<tradie's first name only>",
  "opener_done": false
}

If the tradie (the person being called, not Pou) mentions their name, set name_detected to their first name only. Return it every time you hear it — even if you've returned it before. If you hear a different name than a previously detected one, return the new one. If no name detected, return null.

Set opener_done to true if Pou's recent transcript shows he has introduced himself and Tradeflow to the prospect. Otherwise false."""

_system_prompt = SYSTEM_PROMPT  # enriched with playbook at startup if fetch succeeds


def _build_system_prompt(items: list[dict]) -> str:
    openers     = [i for i in items if i.get('type') == 'opener']
    objections  = [i for i in items if i.get('type') == 'objection']
    talking_pts = [i for i in items if i.get('type') == 'talking_point']
    tones       = [i for i in items if i.get('type') == 'tone']
    sections = []
    if openers:
        sections.append(f"OPENER: {openers[0]['content']}")
    if objections:
        lines = '\n'.join(f"- {o['title']}: {o['content']}" for o in objections)
        sections.append(f"OBJECTIONS & RESPONSES:\n{lines}")
    if talking_pts:
        lines = '\n'.join(f"- {t['title']}: {t['content']}" for t in talking_pts)
        sections.append(f"TALKING POINTS:\n{lines}")
    if tones:
        sections.append(f"TONE: {tones[0]['content']}")
    if not sections:
        return SYSTEM_PROMPT
    return SYSTEM_PROMPT + "\n\n--- PLAYBOOK ---\n" + '\n\n'.join(sections)


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
            max_tokens=400,
            system=_system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"Transcript:\n{transcript_text}",
                }
            ],
        )

        raw = response.content[0].text.strip()
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
        data = json.loads(cleaned)
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

    feed_msg = data.get("feed_message") or ""
    if not feed_msg:
        print("[claude] feed_message missing or empty — skipping feed update")
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
    else:
        await event_queue.put({"type": "objection_cleared"})

    await event_queue.put({"type": "opener_status", "done": bool(data.get("opener_done", False))})

    name = data.get("name_detected")
    if name and isinstance(name, str) and name.strip():
        await event_queue.put({"type": "name_detected", "name": name.strip()})


# ---------------------------------------------------------------------------
# Coroutine guard — restarts a coroutine if it raises instead of killing gather
# ---------------------------------------------------------------------------

async def _run_forever(coro_factory, name: str):
    import traceback
    while True:
        try:
            await coro_factory()
        except asyncio.CancelledError:
            # In Python 3.11+ catching CancelledError without calling uncancel()
            # leaves the task's cancel counter > 0, causing the next await to
            # raise again — which would propagate out of the while loop and kill
            # the gather.  Reset the counter so the restart sleep runs cleanly.
            t = asyncio.current_task()
            if t is not None:
                try:
                    t.uncancel()
                except AttributeError:
                    pass  # Python < 3.11
            print(f"[{name}] CancelledError — restarting")
        except Exception as exc:
            print(f"[{name}] crashed ({type(exc).__name__}) — restarting in 2s")
            traceback.print_exc()
        try:
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            raise  # Genuine external shutdown — let it propagate


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

def _asyncio_exception_handler(loop, context):
    import traceback
    msg = context.get("exception", context["message"])
    print(f"[asyncio] unhandled exception: {msg}")
    if "exception" in context:
        traceback.print_exception(type(context["exception"]), context["exception"], context["exception"].__traceback__)


async def main():
    global _loop, event_queue, _system_prompt
    _loop = asyncio.get_running_loop()
    _loop.set_exception_handler(_asyncio_exception_handler)
    event_queue = asyncio.Queue()

    # Fetch playbook and enrich system prompt before accepting connections
    print("[ara] Fetching playbook from http://localhost:3000/api/playbook …", flush=True)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                'http://localhost:3000/api/playbook',
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    _system_prompt = _build_system_prompt(data.get('items', []))
                    print(f"[ara] Playbook loaded — {len(data.get('items', []))} items", flush=True)
                else:
                    print(f"[ara] Playbook fetch returned HTTP {resp.status} — using default prompt", flush=True)
    except Exception as e:
        print(f"[ara] Playbook fetch failed ({e}) — using default prompt", flush=True)

    # Start audio capture threads
    threading.Thread(target=audio_thread_pou, daemon=True).start()
    threading.Thread(target=audio_thread_them, daemon=True).start()

    print("[ara] Server starting on ws://localhost:5000")

    try:
        server = await websockets.serve(ws_handler, "localhost", 5000)
    except OSError:
        print("[ara] Port 5000 already in use — another instance is running, exiting.")
        return

    print("[ara] gather starting")
    async with server:
        await asyncio.gather(
            _run_forever(vad_stt_loop_pou, "vad/pou"),
            _run_forever(vad_stt_loop_them, "vad/them"),
            _run_forever(event_broadcaster, "broadcaster"),
            return_exceptions=True,
        )
    print("[ara] gather exited — this should never happen")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"[ara] FATAL: {e}", flush=True)
        import traceback
        traceback.print_exc()
