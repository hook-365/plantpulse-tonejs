#!/usr/bin/env python3
"""PlantPulse Sequencer Simulator — replays captured signal data through
different sequencer configurations to compare note distributions offline.

Usage:
    python3 simulate.py [--url http://host:port] [--config config.json]

Fetches signal data from the server's /api/signal-log endpoint, then
simulates the sequencer with configurable parameters.
"""

import json
import sys
import math
import random
from collections import Counter
from dataclasses import dataclass, field

# --- Scale / Note system ---

SCALES = {
    'pentatonic': [0, 2, 4, 7, 9],
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'dorian': [0, 2, 3, 5, 7, 9, 10],
    'mixolydian': [0, 2, 4, 5, 7, 9, 10],
}

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def build_note_pool(root='G', scale='mixolydian', octaves=4):
    root_midi = {'C':48,'D':50,'E':52,'F':53,'G':55,'A':57,'B':59}[root]
    intervals = SCALES[scale]
    notes = []
    for oct in range(octaves):
        for iv in intervals:
            midi = root_midi + oct * 12 + iv
            name = NOTE_NAMES[midi % 12] + str(midi // 12 - 1)
            notes.append(name)
    return notes


def map_signal_to_note(value, sig_min, sig_max, notes, octave_offset=0):
    rng = sig_max - sig_min
    if rng < 0.01 or not notes:
        return notes[len(notes) // 2] if notes else 'C4'
    norm = max(0, min(1, (value - sig_min) / rng))
    npo = len(notes) // 4
    base = int(norm * (len(notes) - 1))
    idx = max(0, min(len(notes) - 1, base + int(octave_offset * npo)))
    return notes[idx]


# --- Sequencer Configuration ---

@dataclass
class SeqConfig:
    name: str = "default"
    clock_bpm: int = 85
    # Bass config
    bass_steps: list = field(default_factory=lambda: [0, 8])
    bass_walk_range: int = 6  # how many scale degrees to walk
    bass_root_bias: float = 0.3  # 0 = no bias, 1 = always root
    # Arp config
    arp_steps: list = field(default_factory=lambda: [2, 3, 6, 7, 10, 11, 14, 15])
    arp_prob_even: float = 0.4
    arp_prob_odd: float = 0.16
    arp_intervals: list = field(default_factory=lambda: [0, 1, 2, 3, 4, 5])
    # Gen melody config
    gen_mel_steps: list = field(default_factory=lambda: [1, 5, 9, 13])
    gen_mel_prob: float = 0.35
    gen_mel_jitter: int = 3
    # Melody phrase config
    mel_threshold: float = 0.3
    mel_cooldown_steps: int = 32  # in 16th-note steps
    mel_auto_trigger_steps: int = 64  # auto-trigger if nothing in N steps
    mel_phrase_len_min: int = 2
    mel_phrase_len_max: int = 5
    mel_odd_steps_only: bool = True
    mel_skip_prob: float = 0.3


# Preset configs to test
CONFIGS = {
    "current": SeqConfig(name="current"),

    "spread": SeqConfig(
        name="spread",
        bass_steps=[0, 8],
        arp_steps=[2, 5, 6, 9, 10, 13, 14],  # more spread, skip some
        arp_prob_even=0.35,
        arp_prob_odd=0.25,
        gen_mel_steps=[1, 3, 7, 11, 15],  # more gen-mel slots
        gen_mel_prob=0.4,
    ),

    "sparse": SeqConfig(
        name="sparse",
        bass_steps=[0, 8],
        bass_root_bias=0.1,
        arp_steps=[2, 6, 10, 14],
        arp_prob_even=0.25,
        arp_prob_odd=0.0,
        gen_mel_steps=[1, 5, 9, 13],
        gen_mel_prob=0.5,
        mel_threshold=0.2,
        mel_cooldown_steps=24,
    ),

    "dense": SeqConfig(
        name="dense",
        bass_steps=[0, 4, 8, 12],
        bass_walk_range=8,
        bass_root_bias=0.15,
        arp_steps=[1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
        arp_prob_even=0.3,
        arp_prob_odd=0.2,
        gen_mel_steps=[1, 3, 5, 7, 9, 11, 13, 15],
        gen_mel_prob=0.3,
        mel_threshold=0.15,
        mel_cooldown_steps=20,
        mel_auto_trigger_steps=40,
    ),

    "syncopated": SeqConfig(
        name="syncopated",
        bass_steps=[0, 7],  # off-grid bass
        bass_walk_range=6,
        arp_steps=[3, 5, 11, 13],  # only off-beats
        arp_prob_even=0.5,
        arp_prob_odd=0.5,
        gen_mel_steps=[1, 6, 9, 14],  # alternating
        gen_mel_prob=0.45,
        mel_threshold=0.2,
        mel_cooldown_steps=28,
    ),

    "hybrid": SeqConfig(
        name="hybrid",
        bass_steps=[0, 8],
        bass_walk_range=7,
        bass_root_bias=0.1,
        arp_steps=[2, 3, 4, 5, 6, 10, 11, 12, 13, 14],  # includes 4 and 12 to fill gaps
        arp_prob_even=0.3,
        arp_prob_odd=0.25,
        arp_intervals=[0, 1, 2, 3, 4, 5],
        gen_mel_steps=[1, 5, 7, 9, 15],
        gen_mel_prob=0.4,
        gen_mel_jitter=3,
        mel_threshold=0.2,
        mel_cooldown_steps=24,
        mel_auto_trigger_steps=48,
        mel_phrase_len_min=2,
        mel_phrase_len_max=5,
        mel_odd_steps_only=True,
        mel_skip_prob=0.25,
    ),

    "hybrid2": SeqConfig(
        name="hybrid2",
        bass_steps=[0, 7],  # syncopated bass — step 7 instead of 8
        bass_walk_range=7,
        bass_root_bias=0.1,
        arp_steps=[2, 4, 5, 10, 12, 13],  # sparser, covers gaps
        arp_prob_even=0.35,
        arp_prob_odd=0.3,
        arp_intervals=[0, 1, 2, 3, 4, 5],
        gen_mel_steps=[1, 3, 6, 9, 11, 14],  # 6 slots across even+odd
        gen_mel_prob=0.35,
        gen_mel_jitter=3,
        mel_threshold=0.2,
        mel_cooldown_steps=22,
        mel_auto_trigger_steps=44,
        mel_phrase_len_min=2,
        mel_phrase_len_max=5,
        mel_odd_steps_only=False,  # melody on any step
        mel_skip_prob=0.25,
    ),

    "hybrid3": SeqConfig(
        name="hybrid3",
        bass_steps=[0, 6],
        bass_walk_range=8,
        bass_root_bias=0.08,
        arp_steps=[2, 3, 8, 10, 11, 14],
        arp_prob_even=0.35,
        arp_prob_odd=0.3,
        arp_intervals=[0, 1, 2, 3, 4, 5],
        gen_mel_steps=[1, 4, 5, 7, 9, 12, 13, 15],  # added 7 and 13
        gen_mel_prob=0.32,
        gen_mel_jitter=4,
        mel_threshold=0.2,
        mel_cooldown_steps=24,
        mel_auto_trigger_steps=48,
        mel_phrase_len_min=2,
        mel_phrase_len_max=5,
        mel_odd_steps_only=False,
        mel_skip_prob=0.2,
    ),

    "minimal": SeqConfig(
        name="minimal",
        bass_steps=[0],
        bass_walk_range=4,
        bass_root_bias=0.5,
        arp_steps=[6, 14],
        arp_prob_even=0.3,
        arp_prob_odd=0.0,
        gen_mel_steps=[3, 11],
        gen_mel_prob=0.6,
        mel_threshold=0.15,
        mel_cooldown_steps=16,
        mel_auto_trigger_steps=32,
        mel_phrase_len_max=4,
    ),
}


# --- Simulator ---

def simulate(signal_data, config, notes, seed=42):
    random.seed(seed)
    events = []
    step = 0
    total_steps = 0
    arp_index = 0
    melody_phrase = []
    mel_phrase_idx = 0
    last_mel_step = -999
    prev_activity_for_mel = 0

    step_ms = 60000 / config.clock_bpm / 4  # 16th note duration

    for sig in signal_data:
        raw = sig['raw']
        smooth = sig['smooth']
        activity = sig['activity']
        smin = sig['sMin']
        smax = sig['sMax']
        t = sig['t']

        # Advance step (approximate: one signal sample ≈ multiple steps possible)
        # At ~5Hz signal rate and ~85bpm, each signal sample ≈ 1.5 steps
        steps_per_sample = max(1, round((1000 / 5) / step_ms))

        for _ in range(steps_per_sample):
            s = step % 16
            is_bar_start = s == 0
            total_steps += 1

            # Bass
            if s in config.bass_steps:
                if random.random() > config.bass_root_bias:
                    walk = random.randint(-config.bass_walk_range // 2, config.bass_walk_range // 2)
                    direction = 1 if raw > smooth else -1
                    walk += direction
                else:
                    walk = 0
                note = map_signal_to_note(smooth, smin, smax, notes, -1)
                idx = notes.index(note) if note in notes else len(notes) // 4
                idx = max(0, min(len(notes) - 1, idx + walk))
                events.append({'step': s, 'note': notes[idx], 'src': 'bass', 't': total_steps})

            # Arp
            if s in config.arp_steps:
                is_even = s % 2 == 0
                prob = config.arp_prob_even if is_even else config.arp_prob_odd
                if random.random() < prob:
                    base = int(max(0, min(1, (raw - smin) / (smax - smin + 0.01))) * len(notes) * 0.6)
                    tone_idx = config.arp_intervals[arp_index % len(config.arp_intervals)]
                    note_idx = min(base + tone_idx, len(notes) - 1)
                    events.append({'step': s, 'note': notes[note_idx], 'src': 'gen-arp', 't': total_steps})
                    arp_index += 1

            # Gen melody
            if s in config.gen_mel_steps:
                if random.random() < config.gen_mel_prob:
                    jitter = random.randint(-config.gen_mel_jitter, config.gen_mel_jitter)
                    idx = int(max(0, min(1, (raw - smin) / (smax - smin + 0.01))) * len(notes) * 0.6)
                    npo = len(notes) // 4
                    idx = max(0, min(len(notes) - 1, idx + jitter + npo))  # octave up
                    events.append({'step': s, 'note': notes[idx], 'src': 'gen-mel', 't': total_steps})

            # Melody phrase
            if melody_phrase and mel_phrase_idx < len(melody_phrase):
                if config.mel_odd_steps_only and s % 2 == 0:
                    pass
                elif random.random() < (1 - config.mel_skip_prob) or mel_phrase_idx == 0:
                    events.append({'step': s, 'note': melody_phrase[mel_phrase_idx], 'src': 'melody', 't': total_steps})
                    mel_phrase_idx += 1
                    if mel_phrase_idx >= len(melody_phrase):
                        melody_phrase = []
                        mel_phrase_idx = 0
            else:
                # Check trigger
                act_delta = activity - prev_activity_for_mel
                prev_activity_for_mel += (activity - prev_activity_for_mel) * 0.06
                steps_since = total_steps - last_mel_step
                if (act_delta > config.mel_threshold or steps_since > config.mel_auto_trigger_steps) and steps_since > config.mel_cooldown_steps:
                    last_mel_step = total_steps
                    plen = random.randint(config.mel_phrase_len_min, config.mel_phrase_len_max)
                    base_idx = int(max(0, min(1, (raw - smin) / (smax - smin + 0.01))) * len(notes) * 0.6)
                    npo = len(notes) // 4
                    cur = base_idx + npo + random.randint(-2, 2)
                    melody_phrase = []
                    for pi in range(plen):
                        step_interval = random.choice([-2, -1, -1, 0, 1, 1, 2, 3])
                        if raw > smooth:
                            step_interval = abs(step_interval) if random.random() < 0.6 else -abs(step_interval)
                        cur = max(0, min(len(notes) - 1, cur + step_interval))
                        melody_phrase.append(notes[cur])
                    mel_phrase_idx = 0

            step += 1

    return events


def analyze(events, name):
    if not events:
        print(f"\n=== {name}: NO EVENTS ===")
        return

    tonal = [e for e in events if e['src'] != 'perc']
    beats = Counter(e['step'] for e in tonal)
    sources = Counter(e['src'] for e in events)
    notes = Counter(e['note'] for e in tonal)

    odd = sum(beats.get(i, 0) for i in [1, 3, 5, 7, 9, 11, 13, 15])
    even = sum(beats.get(i, 0) for i in [0, 2, 4, 6, 8, 10, 12, 14])
    total_tonal = len(tonal)

    # Beat evenness score (lower = more even distribution)
    avg_per_step = total_tonal / 16 if total_tonal else 1
    evenness = sum((beats.get(i, 0) - avg_per_step) ** 2 for i in range(16)) / 16

    # Note variety
    top_note = notes.most_common(1)[0] if notes else ('?', 0)
    top_note_pct = top_note[1] / max(1, total_tonal) * 100

    # Bass repeats
    bass_events = [e for e in events if e['src'] == 'bass']
    bass_reps = sum(1 for i in range(1, len(bass_events)) if bass_events[i]['note'] == bass_events[i - 1]['note'])
    bass_rep_pct = bass_reps / max(1, len(bass_events) - 1) * 100

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")
    print(f"  Total tonal: {total_tonal}  |  Sources: {dict(sources)}")
    print(f"  Odd/Even: {odd}/{even} ({odd*100//max(1,total_tonal)}%/{even*100//max(1,total_tonal)}%)")
    print(f"  Evenness score: {evenness:.1f} (lower=better)")
    print(f"  Unique notes: {len(notes)}")
    print(f"  Top note: {top_note[0]} ({top_note_pct:.0f}%)")
    print(f"  Bass repeats: {bass_rep_pct:.0f}%")
    print(f"  Melody notes: {sources.get('melody', 0)}")

    print(f"\n  Beat distribution:")
    max_count = max(beats.values()) if beats else 1
    for i in range(16):
        c = beats.get(i, 0)
        bar = '#' * int(c / max(1, max_count) * 30)
        print(f"    {i:2d}: {c:3d} {bar}")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8286')
    parser.add_argument('--file', help='Load signal data from JSON file instead of server')
    parser.add_argument('--config', help='Run only this config name')
    parser.add_argument('--root', default='G')
    parser.add_argument('--scale', default='mixolydian')
    args = parser.parse_args()

    # Load signal data
    if args.file:
        with open(args.file) as f:
            data = json.load(f)
            signal_data = data.get('events', data) if isinstance(data, dict) else data
    else:
        import urllib.request
        url = f"{args.url}/api/signal-log?limit=5000"
        print(f"Fetching signal data from {url}...")
        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read())
            signal_data = data.get('events', [])

    print(f"Loaded {len(signal_data)} signal samples")
    if not signal_data:
        print("No signal data! Play music in the browser first.")
        sys.exit(1)

    notes = build_note_pool(args.root, args.scale)
    print(f"Scale: {args.root} {args.scale} ({len(notes)} notes)")

    configs_to_run = CONFIGS
    if args.config:
        configs_to_run = {args.config: CONFIGS[args.config]}

    for name, cfg in configs_to_run.items():
        events = simulate(signal_data, cfg, notes)
        analyze(events, name)

    # Summary comparison
    print(f"\n{'='*60}")
    print(f"  COMPARISON SUMMARY")
    print(f"{'='*60}")
    print(f"  {'Config':<15s} {'Tonal':>6s} {'Odd%':>5s} {'Even':>6s} {'Uniq':>5s} {'Top%':>5s} {'BassR':>6s} {'Mel':>4s}")
    for name, cfg in configs_to_run.items():
        events = simulate(signal_data, cfg, notes)
        tonal = [e for e in events if e['src'] != 'perc']
        beats = Counter(e['step'] for e in tonal)
        n = Counter(e['note'] for e in tonal)
        odd = sum(beats.get(i, 0) for i in [1, 3, 5, 7, 9, 11, 13, 15])
        top_pct = n.most_common(1)[0][1] / max(1, len(tonal)) * 100 if n else 0
        bass_e = [e for e in events if e['src'] == 'bass']
        br = sum(1 for i in range(1, len(bass_e)) if bass_e[i]['note'] == bass_e[i - 1]['note'])
        br_pct = br / max(1, len(bass_e) - 1) * 100
        evenness = sum((beats.get(i, 0) - len(tonal) / 16) ** 2 for i in range(16)) / 16
        print(f"  {name:<15s} {len(tonal):>6d} {odd * 100 // max(1, len(tonal)):>4d}% {evenness:>5.1f} {len(n):>5d} {top_pct:>4.0f}% {br_pct:>5.0f}% {sum(1 for e in events if e['src'] == 'melody'):>4d}")


if __name__ == '__main__':
    main()
